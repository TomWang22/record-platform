// Buyee adapter (web scraping)
// Buyee is a Japanese proxy service that aggregates YahooJP auctions

import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'
import { getBrowserPool } from '../../lib/browser-pool'
import { getRateLimiter } from '../../lib/redis-rate-limiter'
import { getCache } from '../../lib/redis-cache'

export class BuyeeAdapter extends BaseAdapter {
  readonly platform = 'buyee'
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
    
    const cacheKey = `buyee:search:${JSON.stringify(criteria)}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          // Buyee search URL (example - adjust based on actual Buyee structure)
          const searchUrl = this.buildSearchUrl(criteria)
          
          await page.goto(searchUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000,
          })
          
          // Wait for results to load
          await page.waitForSelector('.item-list, .auction-item, [data-item]', { timeout: 10000 }).catch(() => {
            // Results might not have these selectors, continue anyway
          })
          
          // Extract listings from page
          const listings = await page.evaluate(() => {
            const items: Array<Record<string, unknown>> = []
            
            // Try multiple selectors (Buyee structure may vary)
            const selectors = [
              '.item-list .item',
              '.auction-item',
              '[data-item]',
              '.product-item',
            ]
            
            let elements: Element[] = []
            for (const selector of selectors) {
              elements = Array.from(document.querySelectorAll(selector))
              if (elements.length > 0) break
            }
            
            for (const element of elements) {
              try {
                const titleEl = element.querySelector('.title, .item-title, h3, h4') as HTMLElement
                const priceEl = element.querySelector('.price, .item-price, .current-price') as HTMLElement
                const linkEl = element.querySelector('a') as HTMLAnchorElement
                const imageEl = element.querySelector('img') as HTMLImageElement
                
                if (!titleEl || !priceEl || !linkEl) continue
                
                const title = titleEl.textContent?.trim() || ''
                const priceText = priceEl.textContent?.trim() || ''
                const price = this.parsePrice(priceText)
                const url = linkEl.href || ''
                const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || ''
                
                items.push({
                  title,
                  price,
                  currency: 'JPY',
                  url: url.startsWith('http') ? url : `https://buyee.jp${url}`,
                  imageUrl,
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
      { ttl: 300 }  // Cache for 5 minutes
    )
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    await this.rateLimiter.waitForAvailability(this.platform, this.rateLimitConfig)
    
    const cacheKey = `buyee:details:${externalId}`
    
    return this.cache.getOrSet(
      cacheKey,
      async () => {
        const page = await this.browserPool.getPage()
        
        try {
          const url = `https://buyee.jp/item/yahoo/${externalId}`
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
          
          const details = await page.evaluate(() => {
            const titleEl = document.querySelector('.item-title, h1, .product-title') as HTMLElement
            const priceEl = document.querySelector('.current-price, .price, .item-price') as HTMLElement
            const descEl = document.querySelector('.description, .item-description') as HTMLElement
            const imageEl = document.querySelector('.main-image img, .product-image img') as HTMLImageElement
            
            return {
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              description: descEl?.textContent?.trim() || '',
              imageUrl: imageEl?.src || imageEl?.getAttribute('data-src') || '',
            }
          })
          
          return this.mapToRawListing({
            ...details,
            price: this.parsePrice(details.price),
            currency: 'JPY',
            url,
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
    // Buyee doesn't expose completed sales easily
    // Would need to scrape historical data or use YahooJP directly
    return []
  }
  
  private buildSearchUrl(criteria: SearchCriteria): string {
    const baseUrl = 'https://buyee.jp/item/search'
    const params = new URLSearchParams({
      keyword: criteria.query,
    })
    
    if (criteria.priceRange?.min) {
      params.append('min_price', String(criteria.priceRange.min))
    }
    
    if (criteria.priceRange?.max) {
      params.append('max_price', String(criteria.priceRange.max))
    }
    
    return `${baseUrl}?${params.toString()}`
  }
  
  private parsePrice(priceText: string): number {
    // Remove currency symbols and parse
    const cleaned = priceText.replace(/[¥,\s]/g, '')
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
      currency: data.currency || 'JPY',
      images: data.imageUrl ? [data.imageUrl] : [],
      thumbnailUrl: data.imageUrl,
      // Calculate proxy fees (Buyee typically charges 10% + shipping)
      rawData: {
        ...data.rawData,
        proxyFee: data.price * 0.1,
        estimatedShipping: 2000,  // Estimated JPY shipping
      },
    }
  }
  
  private extractIdFromUrl(url: string): string | null {
    const match = url.match(/yahoo\/(\d+)/) || url.match(/item\/(\d+)/)
    return match ? match[1] : null
  }
}

