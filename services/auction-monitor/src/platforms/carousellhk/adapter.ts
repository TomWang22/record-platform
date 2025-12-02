// CarousellHK adapter (web scraping)
// CarousellHK is a Hong Kong marketplace

import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'
import { getBrowserPool } from '../../lib/browser-pool'
import { getRateLimiter } from '../../lib/redis-rate-limiter'
import { getCache } from '../../lib/redis-cache'

export class CarousellHKAdapter extends BaseAdapter {
  readonly platform = 'carousellhk'
  private browserPool = getBrowserPool()
  private rateLimiter = getRateLimiter()
  private cache = getCache()
  
  private readonly rateLimitConfig = {
    requests: 1,
    window: '2s',
    strategy: 'fixed-window' as const,
  }
  
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    await this.rateLimiter.waitForAvailability(this.platform, this.rateLimitConfig)
    
    const cacheKey = `carousellhk:search:${JSON.stringify(criteria)}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const searchUrl = this.buildSearchUrl(criteria)
          
          // CarousellHK is mobile-first, may need mobile user agent
          await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15')
          
          await page.goto(searchUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
          })
          
          await page.waitForSelector('.listing-card, .product-card, [data-testid]', { timeout: 10000 }).catch(() => {})
          
          const listings = await page.evaluate(() => {
            const items: Array<Record<string, unknown>> = []
            
            const selectors = [
              '.listing-card',
              '.product-card',
              '[data-testid*="listing"]',
              '.card',
            ]
            
            let elements: Element[] = []
            for (const selector of selectors) {
              elements = Array.from(document.querySelectorAll(selector))
              if (elements.length > 0) break
            }
            
            for (const element of elements) {
              try {
                const titleEl = element.querySelector('.listing-title, .product-title, h3') as HTMLElement
                const priceEl = element.querySelector('.price, .listing-price, .product-price') as HTMLElement
                const linkEl = element.querySelector('a') as HTMLAnchorElement
                const imageEl = element.querySelector('img') as HTMLImageElement
                const locationEl = element.querySelector('.location, .seller-location') as HTMLElement
                
                if (!titleEl || !priceEl || !linkEl) continue
                
                const title = titleEl.textContent?.trim() || ''
                const priceText = priceEl.textContent?.trim() || ''
                const price = this.parsePrice(priceText)
                const url = linkEl.href || ''
                const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || ''
                const location = locationEl?.textContent?.trim() || ''
                
                items.push({
                  title,
                  price,
                  currency: 'HKD',
                  url: url.startsWith('http') ? url : `https://www.carousell.com.hk${url}`,
                  imageUrl,
                  sellerLocation: location,
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
          })
          
          return listings.map((item: any) => this.mapToRawListing(item))
        } finally {
          await this.browserPool.releasePage(page)
        }
      },
      { ttl: 300 }
    )
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    await this.rateLimiter.waitForAvailability(this.platform, this.rateLimitConfig)
    
    const cacheKey = `carousellhk:details:${externalId}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const url = `https://www.carousell.com.hk/products/${externalId}`
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
          
          const details = await page.evaluate(() => {
            const titleEl = document.querySelector('.product-title, h1') as HTMLElement
            const priceEl = document.querySelector('.price, .product-price') as HTMLElement
            const descEl = document.querySelector('.description, .product-description') as HTMLElement
            const imageEl = document.querySelector('.product-image img, .main-image img') as HTMLImageElement
            const locationEl = document.querySelector('.location, .seller-location') as HTMLElement
            
            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim() || '',
              imageUrl: imageEl?.src || imageEl?.getAttribute('data-src') || '',
              location: locationEl?.textContent?.trim() || '',
            }
          })
          
          return this.mapToRawListing({
            ...details,
            price: this.parsePrice(details.price),
            currency: 'HKD',
            url,
            sellerLocation: details.location,
            rawData: details,
          } as any)
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
  
  private buildSearchUrl(criteria: SearchCriteria): string {
    const baseUrl = 'https://www.carousell.com.hk/search'
    const params = new URLSearchParams({
      query: criteria.query,
    })
    
    return `${baseUrl}?${params.toString()}`
  }
  
  private parsePrice(priceText: string): number {
    const cleaned = priceText.replace(/[HK$,\s]/g, '')
    const match = cleaned.match(/(\d+)/)
    return match ? parseFloat(match[1]) : 0
  }
  
  private mapToRawListing(data: any): RawListing {
    return {
      platform: this.platform,
      externalId: this.extractIdFromUrl(data.url) || Date.now().toString(),
      url: data.url,
      title: data.title,
      description: data.description,
      price: data.price,
      currency: data.currency || 'HKD',
      listingType: 'buy_it_now',
      sellerLocation: data.sellerLocation,
      images: data.imageUrl ? [data.imageUrl] : [],
      thumbnailUrl: data.imageUrl,
      rawData: data.rawData || data,
    }
  }
  
  private extractIdFromUrl(url: string): string | null {
    const match = url.match(/products\/([^/?]+)/) || url.match(/\/([a-zA-Z0-9-]+)$/)
    return match ? match[1] : null
  }
}

