/**
 * Ingestion Worker
 * 
 * Background worker that continuously processes auction listings:
 * 1. Polls platform adapters for new listings
 * 2. Processes through staging pipeline
 * 3. Matches to user watches
 * 4. Ingests to Analytics Service
 * 
 * Runs as a separate process/thread to avoid blocking the main server.
 */

import { Pool } from 'pg'
import { StagingPipeline } from '../pipeline/staging-pipeline'
import { AnalyticsIngestionPipeline } from '../analytics/ingestion-pipeline'
import { eBayAdapter, DiscogsAdapter, BuyeeAdapter, YahooJPAdapter } from '../platforms'
import { getBrowserPool } from '../lib/browser-pool'

export interface WorkerConfig {
  auctionPool: Pool
  analyticsPool: Pool
  platforms: string[]  // ['ebay', 'discogs', 'buyee', ...]
  pollInterval?: number  // Milliseconds between polls
  batchSize?: number  // Number of listings to process per batch
  discogsToken?: string
  ebayAppId?: string
  ebayAuthToken?: string
}

export class IngestionWorker {
  private config: WorkerConfig & {
    pollInterval: number
    batchSize: number
  }
  private pipeline: StagingPipeline
  private analyticsPipeline: AnalyticsIngestionPipeline
  private adapters: Map<string, any> = new Map()
  private running = false
  private intervalId?: NodeJS.Timeout
  
  constructor(config: WorkerConfig) {
    this.config = {
      pollInterval: config.pollInterval || 60000,  // Default: 1 minute
      batchSize: config.batchSize || 50,
      ...config,
    }
    
    this.pipeline = new StagingPipeline(this.config.auctionPool, {
      discogsToken: this.config.discogsToken,
      enableWatchMatching: true,
    })
    
    this.analyticsPipeline = new AnalyticsIngestionPipeline(
      this.config.auctionPool,
      this.config.analyticsPool
    )
    
    this.initializeAdapters()
  }
  
  /**
   * Initialize platform adapters based on configuration
   */
  private initializeAdapters(): void {
    if (this.config.platforms.includes('ebay') && this.config.ebayAppId) {
      this.adapters.set('ebay', new eBayAdapter({
        appId: this.config.ebayAppId,
        authToken: this.config.ebayAuthToken,
        sandbox: process.env.EBAY_SANDBOX === 'true',
      }))
    }
    
    if (this.config.platforms.includes('discogs') && this.config.discogsToken) {
      this.adapters.set('discogs', new DiscogsAdapter({
        userToken: this.config.discogsToken,
      }))
    }
    
    if (this.config.platforms.includes('buyee')) {
      this.adapters.set('buyee', new BuyeeAdapter())
    }
    
    if (this.config.platforms.includes('yahoojp')) {
      this.adapters.set('yahoojp', new YahooJPAdapter())
    }
  }
  
  /**
   * Start the ingestion worker
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[IngestionWorker] Already running')
      return
    }
    
    this.running = true
    console.log('[IngestionWorker] Starting ingestion worker...')
    
    // Process immediately
    await this.processBatch()
    
    // Then process on interval
    this.intervalId = setInterval(async () => {
      try {
        await this.processBatch()
      } catch (error) {
        console.error('[IngestionWorker] Error in batch processing:', error)
      }
    }, this.config.pollInterval)
  }
  
  /**
   * Stop the ingestion worker
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }
    
    this.running = false
    console.log('[IngestionWorker] Stopping ingestion worker...')
    
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    
    // Cleanup browser pool
    const browserPool = getBrowserPool()
    await browserPool.cleanup()
  }
  
  /**
   * Process a batch of listings from all platforms
   */
  private async processBatch(): Promise<void> {
    console.log(`[IngestionWorker] Processing batch (platforms: ${this.config.platforms.join(', ')})`)
    
    const startTime = Date.now()
    let totalProcessed = 0
    let totalErrors = 0
    
    // Process each platform
    for (const platform of this.config.platforms) {
      const adapter = this.adapters.get(platform)
      if (!adapter) {
        console.warn(`[IngestionWorker] Adapter not available for platform: ${platform}`)
        continue
      }
      
      try {
        // Get active watches for this platform
        const watches = await this.getActiveWatches(platform)
        
        if (watches.length === 0) {
          console.log(`[IngestionWorker] No active watches for platform: ${platform}`)
          continue
        }
        
        // Process each watch
        for (const watch of watches) {
          try {
            const criteria = watch.search_criteria as any
            
            // Search listings
            const listings = await adapter.search({
              query: criteria.query || criteria.title || '',
              artist: criteria.artist,
              album: criteria.album,
              catalogNumber: criteria.catalogNumber,
              format: criteria.format,
              condition: criteria.condition,
              priceRange: criteria.priceRange,
              limit: this.config.batchSize,
            })
            
            // Process each listing through pipeline
            for (const listing of listings) {
              try {
                const result = await this.pipeline.processRawListing(listing)
                
                if (result.success) {
                  totalProcessed++
                } else {
                  totalErrors++
                  console.warn(`[IngestionWorker] Failed to process listing: ${result.errors?.join(', ')}`)
                }
              } catch (error) {
                totalErrors++
                console.error(`[IngestionWorker] Error processing listing:`, error)
              }
            }
          } catch (error) {
            console.error(`[IngestionWorker] Error processing watch ${watch.id}:`, error)
          }
        }
      } catch (error) {
        console.error(`[IngestionWorker] Error processing platform ${platform}:`, error)
      }
    }
    
    // Ingest to Analytics Service
    try {
      const analyticsResult = await this.analyticsPipeline.ingestNewListings()
      console.log(`[IngestionWorker] Analytics ingestion: ${analyticsResult.processed} processed, ${analyticsResult.errors} errors`)
    } catch (error) {
      console.error('[IngestionWorker] Error ingesting to Analytics:', error)
    }
    
    const duration = Date.now() - startTime
    console.log(
      `[IngestionWorker] Batch complete: ${totalProcessed} processed, ${totalErrors} errors, ${duration}ms`
    )
  }
  
  /**
   * Get active watches for a platform
   */
  private async getActiveWatches(platform: string): Promise<Array<{ id: string; search_criteria: any }>> {
    const result = await this.config.auctionPool.query(
      `SELECT id, search_criteria, platforms
       FROM auction_monitor.user_watches
       WHERE status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())
         AND platforms @> $1::jsonb`,
      [JSON.stringify([platform])]
    )
    
    return result.rows
  }
}

