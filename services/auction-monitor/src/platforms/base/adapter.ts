// Base platform adapter interface
// All platform adapters must implement this interface

export interface SearchCriteria {
  query: string
  artist?: string
  album?: string
  catalogNumber?: string
  format?: string
  condition?: string
  priceRange?: {
    min?: number
    max?: number
    currency?: string
  }
  limit?: number
  offset?: number
}

export interface RawListing {
  platform: string
  externalId: string
  url: string
  title: string
  description?: string
  price: number
  currency: string
  condition?: string
  format?: string
  artist?: string
  album?: string
  catalogNumber?: string
  label?: string
  year?: number
  sellerId?: string
  sellerName?: string
  sellerFeedbackScore?: number
  sellerLocation?: string
  listingType?: 'auction' | 'buy_it_now' | 'best_offer'
  startingPrice?: number
  buyItNowPrice?: number
  bidCount?: number
  watcherCount?: number
  timeRemaining?: string
  endDate?: Date
  shippingCost?: number
  shippingLocation?: string
  images?: string[]
  thumbnailUrl?: string
  locationRestrictions?: string[]
  paymentRestrictions?: string[]
  reviewRestrictions?: {
    minFeedback?: number
    minAccountAge?: number
    requiresVerifiedPayment?: boolean
  }
  // Platform-specific raw data
  rawData: Record<string, unknown>
}

export interface CompletedSale {
  platform: string
  externalId: string
  title: string
  soldPrice: number
  currency: string
  soldDate: Date
  condition?: string
  format?: string
  url?: string
  rawData: Record<string, unknown>
}

export interface PlatformHealth {
  platform: string
  status: 'healthy' | 'degraded' | 'down'
  responseTime?: number
  error?: string
  checkedAt: Date
}

export interface PlatformAdapter {
  readonly platform: string
  
  /**
   * Search for listings matching the criteria
   */
  search(criteria: SearchCriteria): Promise<RawListing[]>
  
  /**
   * Get detailed information for a specific listing
   */
  getDetails(externalId: string): Promise<RawListing | null>
  
  /**
   * Get completed sales matching the criteria
   */
  getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]>
  
  /**
   * Check platform health/availability
   */
  healthCheck(): Promise<PlatformHealth>
}

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: string
  
  abstract search(criteria: SearchCriteria): Promise<RawListing[]>
  abstract getDetails(externalId: string): Promise<RawListing | null>
  abstract getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]>
  
  async healthCheck(): Promise<PlatformHealth> {
    try {
      const start = Date.now()
      // Try a simple search to verify platform is accessible
      await this.search({ query: 'test', limit: 1 })
      const responseTime = Date.now() - start
      
      return {
        platform: this.platform,
        status: 'healthy',
        responseTime,
        checkedAt: new Date()
      }
    } catch (error) {
      return {
        platform: this.platform,
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date()
      }
    }
  }
  
  protected normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url)
      // Remove query parameters and fragments for comparison
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
      return url
    }
  }
}

