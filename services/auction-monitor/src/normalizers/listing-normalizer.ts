/**
 * Data Normalizer
 * 
 * Converts platform-specific auction listing data to a unified schema.
 * Handles normalization of:
 * - URLs (removes tracking parameters)
 * - Currencies (normalizes to ISO 4217 codes)
 * - Conditions (maps platform-specific values to standard values)
 * - Formats (normalizes format strings)
 * - Prices (calculates estimated totals including proxy fees)
 * 
 * This ensures all listings from different platforms (eBay, Discogs, Buyee, etc.)
 * can be compared and analyzed using the same schema.
 */

import type { RawListing } from '../platforms/base/adapter'

export interface NormalizedListing {
  platform: string
  externalId: string
  url: string
  title: string
  description?: string
  currentPrice: number
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
  bidCount: number
  watcherCount: number
  timeRemaining?: string
  endDate?: Date
  shippingCost?: number
  shippingLocation?: string
  estimatedTotal?: number
  proxyService?: string
  proxyFee?: number
  consolidationFee?: number
  internationalShipping?: number
  images?: string[]
  thumbnailUrl?: string
  locationRestrictions?: string[]
  paymentRestrictions?: string[]
  reviewRestrictions?: {
    minFeedback?: number
    minAccountAge?: number
    requiresVerifiedPayment?: boolean
  }
}

export class ListingNormalizer {
  /**
   * Normalize a raw listing from any platform to the unified schema
   * @param raw - Raw listing data from platform adapter
   * @returns Normalized listing with unified schema
   */
  normalize(raw: RawListing): NormalizedListing {
    return {
      platform: raw.platform,
      externalId: raw.externalId,
      url: this.normalizeUrl(raw.url),
      title: this.normalizeTitle(raw.title),
      description: raw.description,
      currentPrice: raw.price,
      currency: this.normalizeCurrency(raw.currency),
      condition: this.normalizeCondition(raw.condition, raw.platform),
      format: this.normalizeFormat(raw.format),
      artist: raw.artist,
      album: raw.album,
      catalogNumber: raw.catalogNumber,
      label: raw.label,
      year: raw.year,
      sellerId: raw.sellerId,
      sellerName: raw.sellerName,
      sellerFeedbackScore: raw.sellerFeedbackScore,
      sellerLocation: raw.sellerLocation,
      listingType: raw.listingType,
      startingPrice: raw.startingPrice,
      buyItNowPrice: raw.buyItNowPrice,
      bidCount: raw.bidCount || 0,
      watcherCount: raw.watcherCount || 0,
      timeRemaining: raw.timeRemaining,
      endDate: raw.endDate,
      shippingCost: raw.shippingCost,
      shippingLocation: raw.shippingLocation,
      estimatedTotal: this.calculateEstimatedTotal(raw),
      images: raw.images,
      thumbnailUrl: raw.thumbnailUrl,
      locationRestrictions: raw.locationRestrictions,
      paymentRestrictions: raw.paymentRestrictions,
      reviewRestrictions: raw.reviewRestrictions,
    }
  }
  
  /**
   * Normalize URL by removing tracking parameters
   * Removes UTM parameters and referrer tracking to enable URL-based deduplication
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url)
      // Remove tracking parameters (utm_source, utm_medium, etc.)
      const cleanParams = new URLSearchParams()
      for (const [key, value] of parsed.searchParams.entries()) {
        if (!['utm_source', 'utm_medium', 'utm_campaign', 'ref'].includes(key.toLowerCase())) {
          cleanParams.append(key, value)
        }
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}${cleanParams.toString() ? '?' + cleanParams.toString() : ''}`
    } catch {
      return url
    }
  }
  
  private normalizeTitle(title: string): string {
    // Clean up title: remove extra whitespace, normalize quotes
    return title
      .replace(/\s+/g, ' ')
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      .trim()
  }
  
  /**
   * Normalize currency to ISO 4217 codes
   * Handles common currency symbols and abbreviations (e.g., $ → USD, ¥ → JPY)
   */
  private normalizeCurrency(currency: string): string {
    // Normalize to ISO 4217 codes
    const currencyMap: Record<string, string> = {
      'usd': 'USD',
      'us$': 'USD',
      '$': 'USD',
      'eur': 'EUR',
      '€': 'EUR',
      'gbp': 'GBP',
      '£': 'GBP',
      'jpy': 'JPY',
      '¥': 'JPY',
      'hkd': 'HKD',
      'hk$': 'HKD',
    }
    
    const normalized = currency.toUpperCase().trim()
    return currencyMap[normalized] || normalized
  }
  
  /**
   * Normalize condition to standard values (Mint, Near Mint, Very Good, etc.)
   * Platform-specific mappings:
   * - eBay: "New" → "Mint", "Used" → "Very Good"
   * - Discogs: Already standardized
   * - Others: Generic normalization
   */
  private normalizeCondition(condition: string | undefined, platform: string): string | undefined {
    if (!condition) return undefined
    
    const normalized = condition.trim()
    
    // Platform-specific mappings
    if (platform === 'ebay') {
      const ebayMap: Record<string, string> = {
        'new': 'Mint',
        'new (other)': 'Mint',
        'new with tags': 'Mint',
        'used': 'Very Good',
        'pre-owned': 'Very Good',
        'for parts or not working': 'Poor',
      }
      const lower = normalized.toLowerCase()
      return ebayMap[lower] || normalized
    }
    
    if (platform === 'discogs') {
      // Discogs already uses standard conditions
      return normalized
    }
    
    // Generic normalization
    const conditionMap: Record<string, string> = {
      'm': 'Mint',
      'mint': 'Mint',
      'nm': 'Near Mint',
      'near mint': 'Near Mint',
      'm-': 'Near Mint',
      'vg+': 'Very Good Plus',
      'very good plus': 'Very Good Plus',
      'vg': 'Very Good',
      'very good': 'Very Good',
      'g+': 'Good Plus',
      'good plus': 'Good Plus',
      'g': 'Good',
      'good': 'Good',
      'p': 'Poor',
      'poor': 'Poor',
    }
    
    const lower = normalized.toLowerCase()
    return conditionMap[lower] || normalized
  }
  
  private normalizeFormat(format: string | undefined): string | undefined {
    if (!format) return undefined
    
    const normalized = format.trim().toUpperCase()
    
    const formatMap: Record<string, string> = {
      'LP': 'LP',
      '12"': 'LP',
      '12 INCH': 'LP',
      '7"': '7"',
      '7 INCH': '7"',
      '45': '7"',
      'CD': 'CD',
      'COMPACT DISC': 'CD',
      'CASSETTE': 'Cassette',
      'TAPE': 'Cassette',
      'DIGITAL': 'Digital',
      'MP3': 'Digital',
      'FLAC': 'Digital',
    }
    
    return formatMap[normalized] || format
  }
  
  /**
   * Calculate estimated total cost including shipping and proxy fees
   * For proxy services (Buyee, YahooJP), adds 10% proxy fee
   * Returns undefined if no additional costs (price only)
   */
  private calculateEstimatedTotal(raw: RawListing): number | undefined {
    let total = raw.price
    
    if (raw.shippingCost) {
      total += raw.shippingCost
    }
    
    // Add proxy fees if applicable (Buyee, YahooJP require proxy service)
    if (raw.platform === 'buyee' || raw.platform === 'yahoojp') {
      // Proxy fee is typically 10% of item price
      const proxyFee = raw.price * 0.1
      total += proxyFee
    }
    
    return total > raw.price ? total : undefined
  }
}

