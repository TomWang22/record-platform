// YahooJP Auctions adapter (web scraping)
// YahooJP is Japan's largest auction platform

import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'
import { getBrowserPool } from '../../lib/browser-pool'
import { getRateLimiter } from '../../lib/redis-rate-limiter'
import { getCache } from '../../lib/redis-cache'

export class YahooJPAdapter extends BaseAdapter {
  readonly platform = 'yahoojp'
  private browserPool = getBrowserPool()
  private rateLimiter = getRateLimiter()
  private cache = getCache()
  
  private readonly rateLimitConfig = {
    requests: 1,
    window: '2s',  // 1 request per 2 seconds
    strategy: 'fixed-window' as const,
  }
  
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    await this.rateLimiter.waitForAvailability(this.platform, this.rateLimitConfig)
    
    const cacheKey = `yahoojp:search:${JSON.stringify(criteria)}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const searchUrl = this.buildSearchUrl(criteria)
          
          await page.goto(searchUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
          })
          
          // Wait for auction results
          await page.waitForSelector('.Product, .product, [data-auction-id]', { timeout: 10000 }).catch(() => {})
          
          const listings = await page.evaluate(() => {
            const items: Array<Record<string, unknown>> = []
            
            const selectors = [
              '.Product',
              '.product',
              '[data-auction-id]',
              '.auction-item',
            ]
            
            let elements: Element[] = []
            for (const selector of selectors) {
              elements = Array.from(document.querySelectorAll(selector))
              if (elements.length > 0) break
            }
            
            for (const element of elements) {
              try {
                const titleEl = element.querySelector('.Product__title, .product-title, h3') as HTMLElement
                const priceEl = element.querySelector('.Product__price, .price, .current-price') as HTMLElement
                const linkEl = element.querySelector('a') as HTMLAnchorElement
                const imageEl = element.querySelector('img') as HTMLImageElement
                const timeEl = element.querySelector('.Product__time, .time-remaining') as HTMLElement
                const bidEl = element.querySelector('.Product__bid, .bid-count') as HTMLElement
                
                if (!titleEl || !priceEl || !linkEl) continue
                
                const title = titleEl.textContent?.trim() || ''
                const priceText = priceEl.textContent?.trim() || ''
                const price = this.parsePrice(priceText)
                const url = linkEl.href || ''
                const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || ''
                const timeRemaining = timeEl?.textContent?.trim() || ''
                const bidCount = this.parseBidCount(bidEl?.textContent?.trim() || '0')
                
                items.push({
                  title,
                  price,
                  currency: 'JPY',
                  url: url.startsWith('http') ? url : `https://page.auctions.yahoo.co.jp${url}`,
                  imageUrl,
                  timeRemaining,
                  bidCount,
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
          
          return listings.map(item => this.mapToRawListing(item as any))
        } finally {
          await this.browserPool.releasePage(page)
        }
      },
      { ttl: 300 }  // Cache for 5 minutes
    )
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    await this.rateLimiter.waitForAvailability(this.platform, this.rateLimitConfig)
    
    const cacheKey = `yahoojp:details:${externalId}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const url = `https://page.auctions.yahoo.co.jp/jp/auction/${externalId}`
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
          
          const details = await page.evaluate(() => {
            const titleEl = document.querySelector('.ProductTitle, h1, .product-title') as HTMLElement
            const priceEl = document.querySelector('.Price, .current-price, .price') as HTMLElement
            const descEl = document.querySelector('.Description, .product-description') as HTMLElement
            const imageEl = document.querySelector('.ProductImage img, .main-image img') as HTMLImageElement
            const timeEl = document.querySelector('.TimeRemaining, .time-remaining') as HTMLElement
            const bidEl = document.querySelector('.BidCount, .bid-count') as HTMLElement
            const sellerEl = document.querySelector('.Seller, .seller-name') as HTMLElement
            
            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim() || '',
              imageUrl: imageEl?.src || imageEl?.getAttribute('data-src') || '',
              timeRemaining: timeEl?.textContent?.trim() || '',
              bidCount: bidEl?.textContent?.trim() || '0',
              sellerName: sellerEl?.textContent?.trim() || '',
            }
          })
          
          return this.mapToRawListing({
            ...details,
            price: this.parsePrice(details.price),
            currency: 'JPY',
            url,
            bidCount: this.parseBidCount(details.bidCount),
            rawData: details,
          } as any)
        } finally {
          await this.browserPool.releasePage(page)
        }
      },
      { ttl: 600 }  // Cache for 10 minutes
    )
  }
  
  async getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]> {
    // YahooJP doesn't easily expose completed sales via scraping
    return []
  }
  
  private buildSearchUrl(criteria: SearchCriteria): string {
    const baseUrl = 'https://auctions.yahoo.co.jp/search/search'
    const params = new URLSearchParams({
      va: criteria.query,  // YahooJP uses 'va' for search query
      ei: 'UTF-8',
    })
    
    if (criteria.priceRange?.min) {
      params.append('min', String(criteria.priceRange.min))
    }
    
    if (criteria.priceRange?.max) {
      params.append('max', String(criteria.priceRange.max))
    }
    
    return `${baseUrl}?${params.toString()}`
  }
  
  private parsePrice(priceText: string): number {
    const cleaned = priceText.replace(/[¥,\s]/g, '')
    const match = cleaned.match(/(\d+)/)
    return match ? parseFloat(match[1]) : 0
  }
  
  private parseBidCount(bidText: string): number {
    const match = bidText.match(/(\d+)/)
    return match ? parseInt(match[1], 10) : 0
  }
  
  private mapToRawListing(data: any): RawListing {
    return {
      platform: this.platform,
      externalId: this.extractIdFromUrl(data.url) || Date.now().toString(),
      url: data.url,
      title: data.title,
      description: data.description,
      price: data.price,
      currency: data.currency || 'JPY',
      listingType: 'auction',
      bidCount: data.bidCount || 0,
      timeRemaining: data.timeRemaining,
      sellerName: data.sellerName,
      images: data.imageUrl ? [data.imageUrl] : [],
      thumbnailUrl: data.imageUrl,
      rawData: data.rawData || data,
    }
  }
  
  private extractIdFromUrl(url: string): string | null {
    const match = url.match(/auction\/([a-zA-Z0-9]+)/) || url.match(/\/jp\/auction\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  }
}

