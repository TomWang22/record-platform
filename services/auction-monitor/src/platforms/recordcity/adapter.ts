// RecordCity adapter (web scraping, multi-region: UK, US, EU)
// RecordCity operates separate sites for different regions

import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'
import { getBrowserPool } from '../../lib/browser-pool'
import { getRateLimiter } from '../../lib/redis-rate-limiter'
import { getCache } from '../../lib/redis-cache'

export type RecordCityRegion = 'uk' | 'us' | 'eu'

export class RecordCityAdapter extends BaseAdapter {
  readonly platform = 'recordcity'
  private browserPool = getBrowserPool()
  private rateLimiter = getRateLimiter()
  private cache = getCache()
  private regions: RecordCityRegion[] = ['uk', 'us', 'eu']
  
  private readonly rateLimitConfig = {
    requests: 1,
    window: '2s',
    strategy: 'fixed-window' as const,
  }
  
  private readonly baseUrls: Record<RecordCityRegion, string> = {
    uk: 'https://www.recordcity.co.uk',
    us: 'https://www.recordcity.com',
    eu: 'https://www.recordcity.eu',
  }
  
  private readonly currencies: Record<RecordCityRegion, string> = {
    uk: 'GBP',
    us: 'USD',
    eu: 'EUR',
  }
  
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    // Search across all regions in parallel
    const regionSearches = this.regions.map(region => 
      this.searchRegion(region, criteria)
    )
    
    const results = await Promise.all(regionSearches)
    return results.flat()
  }
  
  private async searchRegion(region: RecordCityRegion, criteria: SearchCriteria): Promise<RawListing[]> {
    await this.rateLimiter.waitForAvailability(`${this.platform}:${region}`, this.rateLimitConfig)
    
    const cacheKey = `recordcity:${region}:search:${JSON.stringify(criteria)}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const searchUrl = this.buildSearchUrl(region, criteria)
          
          await page.goto(searchUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
          })
          
          await page.waitForSelector('.product, .item, [data-product-id]', { timeout: 10000 }).catch(() => {})
          
          const listings = await page.evaluate((regionData) => {
            const items: Array<Record<string, unknown>> = []
            const { region, currency } = regionData as { region: string; currency: string }
            
            const selectors = [
              '.product',
              '.item',
              '[data-product-id]',
              '.product-card',
            ]
            
            let elements: Element[] = []
            for (const selector of selectors) {
              elements = Array.from(document.querySelectorAll(selector))
              if (elements.length > 0) break
            }
            
            for (const element of elements) {
              try {
                const titleEl = element.querySelector('.product-title, .title, h3') as HTMLElement
                const priceEl = element.querySelector('.price, .product-price, .current-price') as HTMLElement
                const linkEl = element.querySelector('a') as HTMLAnchorElement
                const imageEl = element.querySelector('img') as HTMLImageElement
                const conditionEl = element.querySelector('.condition, .grade') as HTMLElement
                
                if (!titleEl || !priceEl || !linkEl) continue
                
                const title = titleEl.textContent?.trim() || ''
                const priceText = priceEl.textContent?.trim() || ''
                const price = this.parsePrice(priceText, currency)
                const url = linkEl.href || ''
                const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || ''
                const condition = conditionEl?.textContent?.trim() || ''
                
                items.push({
                  title,
                  price,
                  currency,
                  url: url.startsWith('http') ? url : `${regionData.baseUrl}${url}`,
                  imageUrl,
                  condition,
                  region,
                  rawData: {
                    title,
                    priceText,
                    url,
                  },
                })
              } catch (error) {
                console.error('Error extracting item:', error)
              }
            }
            
            return items
          }, { region, currency: this.currencies[region], baseUrl: this.baseUrls[region] })
          
          return listings.map(item => this.mapToRawListing(item as any, region))
        } finally {
          await this.browserPool.releasePage(page)
        }
      },
      { ttl: 300 }
    )
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    // Try each region until we find the item
    for (const region of this.regions) {
      try {
        const listing = await this.getDetailsForRegion(region, externalId)
        if (listing) return listing
      } catch (error) {
        console.error(`[RecordCity] Error getting details from ${region}:`, error)
      }
    }
    
    return null
  }
  
  private async getDetailsForRegion(region: RecordCityRegion, externalId: string): Promise<RawListing | null> {
    await this.rateLimiter.waitForAvailability(`${this.platform}:${region}`, this.rateLimitConfig)
    
    const cacheKey = `recordcity:${region}:details:${externalId}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const url = `${this.baseUrls[region]}/product/${externalId}`
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
          
          const details = await page.evaluate((regionData) => {
            const { currency } = regionData as { currency: string }
            
            const titleEl = document.querySelector('.product-title, h1') as HTMLElement
            const priceEl = document.querySelector('.price, .product-price') as HTMLElement
            const descEl = document.querySelector('.description, .product-description') as HTMLElement
            const imageEl = document.querySelector('.product-image img, .main-image img') as HTMLImageElement
            const conditionEl = document.querySelector('.condition, .grade') as HTMLElement
            const formatEl = document.querySelector('.format, .media-type') as HTMLElement
            
            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim() || '',
              imageUrl: imageEl?.src || imageEl?.getAttribute('data-src') || '',
              condition: conditionEl?.textContent?.trim() || '',
              format: formatEl?.textContent?.trim() || '',
              currency,
            }
          }, { currency: this.currencies[region] })
          
          return this.mapToRawListing({
            ...details,
            price: this.parsePrice(details.price, details.currency),
            url,
            rawData: details,
          } as any, region)
        } finally {
          await this.browserPool.releasePage(page)
        }
      },
      { ttl: 600 }
    )
  }
  
  async getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]> {
    return []
  }
  
  private buildSearchUrl(region: RecordCityRegion, criteria: SearchCriteria): string {
    const baseUrl = this.baseUrls[region]
    const params = new URLSearchParams({
      q: criteria.query,
      search: criteria.query,
    })
    
    if (criteria.priceRange?.min) {
      params.append('min_price', String(criteria.priceRange.min))
    }
    
    if (criteria.priceRange?.max) {
      params.append('max_price', String(criteria.priceRange.max))
    }
    
    return `${baseUrl}/search?${params.toString()}`
  }
  
  private parsePrice(priceText: string, currency: string): number {
    const symbols: Record<string, string> = {
      'GBP': '£',
      'USD': '$',
      'EUR': '€',
    }
    
    const symbol = symbols[currency] || ''
    const cleaned = priceText.replace(new RegExp(`[${symbol},\\s]`, 'g'), '')
    const match = cleaned.match(/(\d+\.?\d*)/)
    return match ? parseFloat(match[1]) : 0
  }
  
  private mapToRawListing(data: any, region: RecordCityRegion): RawListing {
    return {
      platform: `${this.platform}:${region}`,
      externalId: this.extractIdFromUrl(data.url) || Date.now().toString(),
      url: data.url,
      title: data.title,
      description: data.description,
      price: data.price,
      currency: data.currency || this.currencies[region],
      condition: data.condition,
      format: data.format,
      listingType: 'buy_it_now',
      images: data.imageUrl ? [data.imageUrl] : [],
      thumbnailUrl: data.imageUrl,
      rawData: {
        ...data.rawData,
        region,
      },
    }
  }
  
  private extractIdFromUrl(url: string): string | null {
    const match = url.match(/product\/([^/?]+)/) || url.match(/\/([a-zA-Z0-9-]+)$/)
    return match ? match[1] : null
  }
}

