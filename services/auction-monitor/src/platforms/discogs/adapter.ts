// Discogs API Adapter
// Uses Discogs Database API and Marketplace API

import axios, { AxiosInstance } from 'axios'
import { BaseAdapter, type RawListing, type SearchCriteria, type CompletedSale } from '../base/adapter'

interface DiscogsConfig {
  userToken: string
  userAgent?: string
}

interface DiscogsRelease {
  id: number
  title: string
  artists?: Array<{ name: string }>
  formats?: Array<{ name: string; qty?: string; descriptions?: string[] }>
  labels?: Array<{ name: string; catno?: string }>
  year?: number
  genres?: string[]
  styles?: string[]
  tracklist?: Array<{ position: string; title: string; duration?: string }>
  images?: Array<{ uri: string; type: string }>
  uri: string
}

interface DiscogsMarketplaceListing {
  id: number
  status: string
  price: {
    value: number
    currency: string
  }
  release: {
    id: number
    description: string
    catalog_number?: string
    format?: string
  }
  seller: {
    username: string
    resource_url: string
    rating?: number
  }
  ships_from: string
  posted: string
  uri: string
  comments?: string
  sleeve_condition?: string
  media_condition?: string
}

interface DiscogsSearchResponse {
  results?: Array<{
    id: number
    type: string
    title: string
    uri: string
    thumb?: string
  }>
  pagination?: {
    page: number
    pages: number
    per_page: number
    items: number
  }
}

export class DiscogsAdapter extends BaseAdapter {
  readonly platform = 'discogs'
  private client: AxiosInstance
  private config: DiscogsConfig
  private baseUrl = 'https://api.discogs.com'
  
  constructor(config: DiscogsConfig) {
    super()
    this.config = config
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': config.userAgent || 'RecordPlatform/1.0',
        'Authorization': `Discogs token=${config.userToken}`,
      }
    })
  }
  
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    try {
      // First, search for releases matching the query
      const searchParams = new URLSearchParams({
        q: criteria.query,
        type: 'release',
        per_page: String(criteria.limit || 50),
        page: String(Math.floor((criteria.offset || 0) / (criteria.limit || 50)) + 1),
      })
      
      if (criteria.artist) {
        searchParams.append('artist', criteria.artist)
      }
      
      if (criteria.album) {
        searchParams.append('release_title', criteria.album)
      }
      
      const searchResponse = await this.client.get<DiscogsSearchResponse>(`/database/search?${searchParams.toString()}`)
      
      const releases = searchResponse.data.results || []
      
      // Get marketplace listings for each release
      const listings: RawListing[] = []
      for (const release of releases.slice(0, 10)) { // Limit to first 10 to avoid rate limits
        try {
          const releaseListings = await this.getListingsForRelease(release.id)
          listings.push(...releaseListings)
        } catch (error) {
          console.error(`[Discogs] Error getting listings for release ${release.id}:`, error)
        }
      }
      
      return listings
    } catch (error) {
      console.error(`[Discogs] Search error:`, error)
      throw new Error(`Discogs search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  async getDetails(externalId: string): Promise<RawListing | null> {
    try {
      const response = await this.client.get<DiscogsMarketplaceListing>(`/marketplace/listings/${externalId}`)
      return this.mapToRawListing(response.data)
    } catch (error) {
      console.error(`[Discogs] Get details error:`, error)
      return null
    }
  }
  
  async getCompletedSales(criteria: SearchCriteria): Promise<CompletedSale[]> {
    try {
      // Discogs doesn't have a direct "completed sales" API
      // Price history requires browser automation due to CAPTCHA
      // This method uses browser automation to get the full sales history arc
      
      const searchParams = new URLSearchParams({
        q: criteria.query,
        type: 'release',
        per_page: '1',
      })
      
      const searchResponse = await this.client.get<DiscogsSearchResponse>(`/database/search?${searchParams.toString()}`)
      const releases = searchResponse.data.results || []
      
      if (releases.length === 0) {
        return []
      }
      
      // Get release ID
      const releaseId = releases[0].id
      
      // Use browser automation to get full price history (sales arc)
      // This is critical for analytics - shows complete sales history, not just low/median/high
      return await this.getPriceHistoryWithBrowser(releaseId)
    } catch (error) {
      console.error(`[Discogs] Get completed sales error:`, error)
      return []
    }
  }
  
  /**
   * Get price history using browser automation (handles CAPTCHA)
   * 
   * This is critical for analytics because it provides:
   * - Full sales history arc (not just low/median/high)
   * - Individual sale prices over time
   * - Date of each sale
   * - Condition of each sale
   * 
   * The API only provides aggregated statistics, but the price history page
   * shows the complete sales arc which is essential for price prediction.
   */
  async getPriceHistoryWithBrowser(releaseId: number): Promise<CompletedSale[]> {
    try {
      const { scrapeDiscogsPriceHistory, convertToCompletedSales } = await import('./price-history-scraper.js')
      
      // Scrape price history with browser automation
      const priceHistory = await scrapeDiscogsPriceHistory({
        releaseId,
        waitForCaptcha: process.env.DISCOGS_WAIT_FOR_CAPTCHA !== 'false', // Default: wait for manual solve
        captchaTimeout: parseInt(process.env.DISCOGS_CAPTCHA_TIMEOUT || '120000', 10),
        maxRetries: parseInt(process.env.DISCOGS_MAX_RETRIES || '3', 10),
      })
      
      // Convert to CompletedSale format
      // Note: title is not available from price history alone, use releaseId as fallback
      return convertToCompletedSales(priceHistory, releaseId, `Discogs Release ${releaseId}`)
    } catch (error) {
      console.error(`[Discogs] Error getting price history with browser for release ${releaseId}:`, error)
      
      // If browser automation fails, return empty array
      // The API doesn't provide this data, so we can't fall back
      return []
    }
  }
  
  private async getListingsForRelease(releaseId: number): Promise<RawListing[]> {
    try {
      const response = await this.client.get<{ listings?: DiscogsMarketplaceListing[] }>(`/marketplace/release/${releaseId}`)
      const listings = response.data.listings || []
      
      return listings
        .filter(listing => listing.status === 'For Sale')
        .map(listing => this.mapToRawListing(listing))
    } catch (error) {
      console.error(`[Discogs] Get listings for release error:`, error)
      return []
    }
  }
  
  private mapToRawListing(listing: DiscogsMarketplaceListing): RawListing {
    const release = listing.release || {}
    const description = listing.release?.description || ''
    
    return {
      platform: this.platform,
      externalId: String(listing.id),
      url: listing.uri || '',
      title: description,
      price: listing.price.value,
      currency: listing.price.currency,
      condition: this.normalizeCondition(listing.media_condition, listing.sleeve_condition),
      format: release.format || this.extractFormat(description),
      catalogNumber: release.catalog_number || this.extractCatalogNumber(description),
      artist: this.extractArtist(description),
      album: this.extractAlbum(description),
      sellerName: listing.seller.username,
      sellerFeedbackScore: listing.seller.rating,
      sellerLocation: listing.ships_from,
      listingType: 'buy_it_now',
      shippingCost: 0, // Discogs doesn't provide shipping in listing API
      description: listing.comments,
      rawData: listing as unknown as Record<string, unknown>,
    }
  }
  
  private normalizeCondition(mediaCondition?: string, sleeveCondition?: string): string {
    // Discogs conditions: Mint (M), Near Mint (NM or M-), Very Good Plus (VG+), etc.
    if (mediaCondition) {
      const normalized = mediaCondition.toUpperCase()
      if (normalized.includes('MINT') && !normalized.includes('NEAR')) return 'Mint'
      if (normalized.includes('NEAR') || normalized === 'NM' || normalized === 'M-') return 'Near Mint'
      if (normalized.includes('VG+') || normalized.includes('VERY GOOD PLUS')) return 'Very Good Plus'
      if (normalized.includes('VG') || normalized.includes('VERY GOOD')) return 'Very Good'
      if (normalized.includes('G+') || normalized.includes('GOOD PLUS')) return 'Good Plus'
      if (normalized.includes('G') || normalized.includes('GOOD')) return 'Good'
      return mediaCondition
    }
    return sleeveCondition || 'Unknown'
  }
  
  private extractFormat(description: string): string | undefined {
    const text = description.toUpperCase()
    if (text.includes('LP') || text.includes('12"')) return 'LP'
    if (text.includes('7"') || text.includes('45')) return '7"'
    if (text.includes('CD')) return 'CD'
    if (text.includes('CASSETTE')) return 'Cassette'
    return undefined
  }
  
  private extractCatalogNumber(description: string): string | undefined {
    // Look for catalog number patterns
    const match = description.match(/\b([A-Z]{2,}\s*-?\s*\d{2,})\b/i)
    return match ? match[1].replace(/\s+/g, '') : undefined
  }
  
  private extractArtist(description: string): string | undefined {
    // Discogs format is usually "Artist - Album"
    const match = description.match(/^([^-–—]+)/)
    return match ? match[1].trim() : undefined
  }
  
  private extractAlbum(description: string): string | undefined {
    // Discogs format is usually "Artist - Album"
    const match = description.match(/[-–—]\s*(.+?)(?:\s*\(|\s*\[|$)/)
    return match ? match[1].trim() : undefined
  }
}

