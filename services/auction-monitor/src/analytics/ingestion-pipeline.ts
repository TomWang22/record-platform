/**
 * Analytics Service Ingestion Pipeline
 * 
 * Ingests normalized listings from Auction Monitor into Analytics Service.
 * Performs:
 * - Price percentile calculation (p25, p50, p75, p95)
 * - Historical comparison
 * - Time-series storage
 * - Statistical analysis
 * 
 * Only processes high-confidence listings (confidence ≥ 0.7) to ensure
 * Analytics Service and Python AI Service receive quality data.
 */

import { Pool } from 'pg'
import type { NormalizedListing } from '../normalizers/listing-normalizer'

/**
 * Granular Price Percentiles (p1 through p99)
 * 
 * Calculates every percentile from p1 to p99 for detailed price analysis.
 * This granular approach enables:
 * - Precise price positioning (e.g., "this is at the 47th percentile")
 * - Better negotiation guidance (exact percentile-based recommendations)
 * - More accurate AI predictions (granular data for ML models)
 * - Detailed market analysis (price distribution curves)
 */
export interface PricePercentiles {
  // Granular percentiles (p1 through p99)
  p1: number
  p2: number
  p3: number
  p4: number
  p5: number
  p6: number
  p7: number
  p8: number
  p9: number
  p10: number
  p11: number
  p12: number
  p13: number
  p14: number
  p15: number
  p16: number
  p17: number
  p18: number
  p19: number
  p20: number
  p21: number
  p22: number
  p23: number
  p24: number
  p25: number
  p26: number
  p27: number
  p28: number
  p29: number
  p30: number
  p31: number
  p32: number
  p33: number
  p34: number
  p35: number
  p36: number
  p37: number
  p38: number
  p39: number
  p40: number
  p41: number
  p42: number
  p43: number
  p44: number
  p45: number
  p46: number
  p47: number
  p48: number
  p49: number
  p50: number
  p51: number
  p52: number
  p53: number
  p54: number
  p55: number
  p56: number
  p57: number
  p58: number
  p59: number
  p60: number
  p61: number
  p62: number
  p63: number
  p64: number
  p65: number
  p66: number
  p67: number
  p68: number
  p69: number
  p70: number
  p71: number
  p72: number
  p73: number
  p74: number
  p75: number
  p76: number
  p77: number
  p78: number
  p79: number
  p80: number
  p81: number
  p82: number
  p83: number
  p84: number
  p85: number
  p86: number
  p87: number
  p88: number
  p89: number
  p90: number
  p91: number
  p92: number
  p93: number
  p94: number
  p95: number
  p96: number
  p97: number
  p98: number
  p99: number
  
  // Metadata
  count: number
  confidence: 'high' | 'medium' | 'low'
  min: number
  max: number
  mean: number
  median: number
  stdDev?: number  // Standard deviation (optional, for advanced analysis)
}

export interface HistoricalComparison {
  averagePrice: number
  medianPrice: number
  minPrice: number
  maxPrice: number
  sampleCount: number
  priceTrend: 'increasing' | 'decreasing' | 'stable'
  confidence: 'high' | 'medium' | 'low'
}

export class AnalyticsIngestionPipeline {
  private auctionPool: Pool  // Auction Monitor DB
  private analyticsPool: Pool  // Analytics DB
  
  constructor(auctionPool: Pool, analyticsPool: Pool) {
    this.auctionPool = auctionPool
    this.analyticsPool = analyticsPool
  }
  
  /**
   * Ingest new/updated listings from Auction Monitor to Analytics Service
   * Processes listings with confidence ≥ 0.7
   */
  async ingestNewListings(): Promise<{ processed: number; errors: number }> {
    let processed = 0
    let errors = 0
    
    try {
      // Get new/updated listings with high confidence
      const listings = await this.auctionPool.query(
        `SELECT *
         FROM auction_monitor.normalized_listings
         WHERE confidence_score >= 0.7
           AND (discogs_release_id IS NOT NULL OR catalog_number IS NOT NULL)
         ORDER BY updated_at DESC
         LIMIT 100`
      )
      
      for (const listing of listings.rows) {
        try {
          await this.processListing(listing)
          processed++
        } catch (error) {
          console.error(`[AnalyticsIngestion] Error processing listing ${listing.id}:`, error)
          errors++
        }
      }
    } catch (error) {
      console.error('[AnalyticsIngestion] Error fetching listings:', error)
      throw error
    }
    
    return { processed, errors }
  }
  
  /**
   * Process a single listing: calculate percentiles, historical comparison, store snapshots
   */
  private async processListing(listing: any): Promise<void> {
    // 1. Calculate price percentiles
    const percentiles = await this.calculatePercentiles(listing)
    
    // 2. Historical comparison
    const historical = await this.compareWithHistory(listing)
    
    // 3. Store price snapshot (time-series)
    await this.storePriceSnapshot(listing, percentiles, historical)
    
    // 4. Update analytics.price_snapshots (if table exists)
    await this.updateAnalyticsSnapshots(listing, percentiles, historical)
  }
  
  /**
   * Calculate price percentiles for similar items
   * Similar = same catalog number OR (same artist + album + format + condition)
   */
  private async calculatePercentiles(listing: any): Promise<PricePercentiles> {
    // Find similar listings
    let similarQuery = `
      SELECT current_price, currency
      FROM auction_monitor.normalized_listings
      WHERE confidence_score >= 0.7
        AND id != $1
    `
    const params: any[] = [listing.id]
    
    if (listing.catalog_number) {
      // Exact catalog number match (highest confidence)
      similarQuery += ` AND catalog_number = $2`
      params.push(listing.catalog_number)
    } else if (listing.artist && listing.album && listing.format) {
      // Fuzzy match by artist + album + format
      similarQuery += ` AND artist ILIKE $2 AND album ILIKE $3 AND format = $4`
      params.push(`%${listing.artist}%`, `%${listing.album}%`, listing.format)
    } else {
      // Fallback: artist + album only
      if (listing.artist && listing.album) {
        similarQuery += ` AND artist ILIKE $2 AND album ILIKE $3`
        params.push(`%${listing.artist}%`, `%${listing.album}%`)
      } else {
        // Not enough data for comparison
        return this.createDefaultPercentiles(listing.current_price, 0)
      }
    }
    
    similarQuery += ` ORDER BY current_price`
    
    const similar = await this.auctionPool.query(similarQuery, params)
    const prices = similar.rows.map((r: any) => parseFloat(r.current_price))
    
    if (prices.length === 0) {
      // Return default percentiles (all same as current price)
      const defaultPrice = listing.current_price
      return this.createDefaultPercentiles(defaultPrice, 0)
    }
    
    // Calculate granular percentiles (p1 through p99)
    const sorted = prices.sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const median = this.percentile(sorted, 0.50)
    
    // Calculate standard deviation
    const variance = sorted.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / sorted.length
    const stdDev = Math.sqrt(variance)
    
    // Calculate all percentiles from p1 to p99
    const percentiles: any = {}
    for (let p = 1; p <= 99; p++) {
      percentiles[`p${p}`] = this.percentile(sorted, p / 100)
    }
    
    return {
      ...percentiles,
      count: prices.length,
      confidence: prices.length >= 10 ? 'high' : prices.length >= 5 ? 'medium' : 'low',
      min,
      max,
      mean,
      median,
      stdDev,
    }
  }
  
  /**
   * Compare with historical price data
   * 
   * Uses multiple sources:
   * 1. price_history table (our own snapshots)
   * 2. Discogs price history (full sales arc via browser scraping)
   * 3. Similar listings from normalized_listings
   */
  private async compareWithHistory(listing: any): Promise<HistoricalComparison> {
    // Get historical prices from price_history table
    const history = await this.auctionPool.query(
      `SELECT price, snapshot_at
       FROM auction_monitor.price_history
       WHERE normalized_listing_id = $1
         AND snapshot_at > NOW() - INTERVAL '90 days'
       ORDER BY snapshot_at DESC`,
      [listing.id]
    )
    
    // Get Discogs price history if available (full sales arc)
    let discogsHistory: number[] = []
    if (listing.discogs_release_id) {
      try {
        const { scrapeDiscogsPriceHistory } = await import('../platforms/discogs/price-history-scraper.js')
        const priceHistory = await scrapeDiscogsPriceHistory({
          releaseId: listing.discogs_release_id,
          waitForCaptcha: process.env.DISCOGS_WAIT_FOR_CAPTCHA !== 'false',
          captchaTimeout: parseInt(process.env.DISCOGS_CAPTCHA_TIMEOUT || '120000', 10),
        })
        
        // Extract prices from Discogs history (last 90 days)
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
        
        discogsHistory = priceHistory
          .filter((entry: { date: Date }) => entry.date >= ninetyDaysAgo)
          .map((entry: { price: number }) => entry.price)
      } catch (error) {
        console.warn(`[AnalyticsIngestion] Could not fetch Discogs price history for release ${listing.discogs_release_id}:`, error)
        // Continue without Discogs history
      }
    }
    
    // Combine all price sources
    const ourPrices = history.rows.map((r: any) => parseFloat(r.price))
    const allPrices = [...ourPrices, ...discogsHistory]
    
    if (allPrices.length === 0) {
      return {
        averagePrice: listing.current_price,
        medianPrice: listing.current_price,
        minPrice: listing.current_price,
        maxPrice: listing.current_price,
        sampleCount: 0,
        priceTrend: 'stable',
        confidence: 'low',
      }
    }
    
    // Calculate statistics
    const sorted = allPrices.sort((a, b) => a - b)
    const average = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const median = this.percentile(sorted, 0.50)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    
    // Calculate trend (compare recent vs older prices)
    // If we have Discogs history, use it for trend (it's more complete)
    const trendPrices = discogsHistory.length > 0 ? discogsHistory : allPrices
    const recentPrices = trendPrices.slice(0, Math.floor(trendPrices.length / 2))
    const olderPrices = trendPrices.slice(Math.floor(trendPrices.length / 2))
    
    let priceTrend: 'increasing' | 'decreasing' | 'stable' = 'stable'
    if (recentPrices.length > 0 && olderPrices.length > 0) {
      const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length
      const olderAvg = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length
      
      if (recentAvg > olderAvg * 1.1) {
        priceTrend = 'increasing'
      } else if (recentAvg < olderAvg * 0.9) {
        priceTrend = 'decreasing'
      }
    }
    
    // Confidence based on sample size and data sources
    let confidence: 'high' | 'medium' | 'low' = 'low'
    if (allPrices.length >= 20 || (allPrices.length >= 10 && discogsHistory.length > 0)) {
      confidence = 'high'
    } else if (allPrices.length >= 5) {
      confidence = 'medium'
    }
    
    return {
      averagePrice: average,
      medianPrice: median,
      minPrice: min,
      maxPrice: max,
      sampleCount: allPrices.length,
      priceTrend,
      confidence,
    }
  }
  
  /**
   * Store price snapshot in time-series table
   * Includes granular percentiles (p1-p99) in metadata
   */
  private async storePriceSnapshot(
    listing: any,
    percentiles: PricePercentiles,
    historical: HistoricalComparison
  ): Promise<void> {
    // Calculate current price position (which percentile)
    const pricePosition = this.calculatePricePosition(listing.current_price, percentiles)
    
    await this.auctionPool.query(
      `INSERT INTO auction_monitor.price_history (
        normalized_listing_id, snapshot_at, price, currency,
        bid_count, watcher_count, status, metadata
      ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)
      ON CONFLICT DO NOTHING`,
      [
        listing.id,
        listing.current_price,
        listing.currency,
        listing.bid_count || 0,
        listing.watcher_count || 0,
        'active',
        JSON.stringify({
          // Store all granular percentiles (p1-p99)
          percentiles: {
            // Include all percentiles for detailed analysis
            ...percentiles,
            // Also include summary for quick access
            summary: {
              p25: percentiles.p25,
              p50: percentiles.p50,
              p75: percentiles.p75,
              p95: percentiles.p95,
            },
          },
          historical,
          confidence: listing.confidence_score,
          // Current price position (which percentile)
          pricePosition,
        }),
      ]
    )
  }
  
  /**
   * Calculate which percentile the current price falls into
   * Returns value 0.0-1.0 (e.g., 0.60 = 60th percentile)
   */
  private calculatePricePosition(currentPrice: number, percentiles: PricePercentiles): number {
    // Find the percentile that current price is closest to
    for (let p = 1; p <= 99; p++) {
      const percentileValue = (percentiles as any)[`p${p}`]
      if (currentPrice <= percentileValue) {
        return p / 100
      }
    }
    // If price is above p99, return 0.99
    return 0.99
  }
  
  /**
   * Update analytics.price_snapshots table
   */
  private async updateAnalyticsSnapshots(
    listing: any,
    percentiles: PricePercentiles,
    historical: HistoricalComparison
  ): Promise<void> {
    try {
      // Check if analytics schema exists
      await this.analyticsPool.query(
        `INSERT INTO analytics.price_snapshots (
          snap_date, artist, name, format, median_price, sample_count
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (snap_date, artist, name, format) DO UPDATE SET
          median_price = EXCLUDED.median_price,
          sample_count = EXCLUDED.sample_count`,
        [
          new Date().toISOString().split('T')[0],  // Today's date
          listing.artist || 'Unknown',
          listing.album || listing.title || 'Unknown',
          listing.format || 'Unknown',
          percentiles.p50,
          percentiles.count,
        ]
      )
    } catch (error) {
      // Table might not exist yet, log and continue
      console.warn('[AnalyticsIngestion] analytics.price_snapshots table not found, skipping:', error)
    }
  }
  
  /**
   * Calculate percentile from sorted array
   * Uses linear interpolation for precise percentile calculation
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    
    const index = p * (sorted.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    const weight = index - lower
    
    if (lower === upper) {
      return sorted[lower]
    }
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
  }
  
  /**
   * Create default percentiles (all same value) when no data available
   */
  private createDefaultPercentiles(price: number, count: number): PricePercentiles {
    const percentiles: any = {}
    for (let p = 1; p <= 99; p++) {
      percentiles[`p${p}`] = price
    }
    
    return {
      ...percentiles,
      count,
      confidence: 'low',
      min: price,
      max: price,
      mean: price,
      median: price,
      stdDev: 0,
    }
  }
}

