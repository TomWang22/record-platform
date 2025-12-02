/**
 * Staging Pipeline
 * 
 * ETL pipeline that processes raw listings through:
 * 1. Storage: Store raw data in raw_listings table
 * 2. Normalization: Convert to unified schema
 * 3. Validation: Validate required fields, data types, business rules
 * 4. Deduplication: Check for existing listings (exact match, URL match)
 * 5. Confidence Scoring: Calculate multi-factor confidence score
 * 6. Storage: Store in normalized_listings if valid & confidence ≥ 0.5
 * 
 * Uses database transactions to ensure atomicity.
 * Only high-confidence data (≥0.5) is stored in normalized_listings.
 * High-confidence data (≥0.7) is fed to Analytics Service.
 */

import { Pool } from 'pg'
import type { RawListing } from '../platforms/base/adapter'
import { ListingNormalizer, type NormalizedListing } from '../normalizers/listing-normalizer'
import { ListingValidator, type ValidationResult } from '../validators/listing-validator'
import { CatalogEnricher } from '../enrichers/catalog-enricher'
import { WatchMatcher } from '../matching/watch-matcher'

export interface StagingResult {
  success: boolean
  rawListingId?: string
  normalizedListingId?: string
  errors?: string[]
  warnings?: string[]
  confidence?: number
}

export class StagingPipeline {
  private pool: Pool
  private normalizer: ListingNormalizer
  private validator: ListingValidator
  private enricher?: CatalogEnricher
  private watchMatcher?: WatchMatcher
  
  constructor(
    pool: Pool,
    options?: {
      discogsToken?: string
      enableWatchMatching?: boolean
    }
  ) {
    this.pool = pool
    this.normalizer = new ListingNormalizer()
    this.validator = new ListingValidator()
    
    // Initialize enricher if Discogs token provided
    if (options?.discogsToken) {
      this.enricher = new CatalogEnricher({
        userToken: options.discogsToken,
      })
    }
    
    // Initialize watch matcher if enabled
    if (options?.enableWatchMatching !== false) {
      this.watchMatcher = new WatchMatcher(pool)
    }
  }
  
  /**
   * Process a raw listing through the complete ETL pipeline
   * @param raw - Raw listing from platform adapter
   * @returns StagingResult with success status, IDs, errors, warnings, confidence
   */
  async processRawListing(raw: RawListing): Promise<StagingResult> {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Step 1: Store in raw_listings table (staging layer)
      const rawId = await this.storeRaw(client, raw)
      
      // Step 2: Normalize platform-specific data to unified schema
      const normalized = this.normalizer.normalize(raw)
      
      // Step 3: Validate normalized data (required fields, data types, business rules)
      const validation = this.validator.validate(normalized)
      
      // Step 4: Check for duplicates (exact match, URL match)
      const duplicates = await this.findDuplicates(client, normalized)
      
      if (duplicates.length > 0) {
        await client.query('COMMIT')
        return {
          success: false,
          rawListingId: rawId,
          errors: [`Duplicate listing found: ${duplicates[0].id}`],
          warnings: validation.warnings,
        }
      }
      
      // Step 5: Enrich with Discogs catalog data (if enricher available)
      let enrichmentResult = null
      if (this.enricher) {
        try {
          enrichmentResult = await this.enricher.enrich(normalized)
          // Update normalized listing with enrichment data
          if (enrichmentResult.discogsReleaseId) {
            // Enrichment will be stored in storeNormalized
          }
        } catch (error) {
          console.warn('[StagingPipeline] Enrichment failed:', error)
          // Continue without enrichment
        }
      }
      
      // Step 6: Calculate confidence score (multi-factor: completeness, source reliability, enrichment)
      const confidence = this.calculateConfidence(normalized, validation, enrichmentResult)
      
      // Step 7: Store in normalized_listings (only if validation passes & confidence ≥ 0.5)
      if (validation.valid && confidence >= 0.5) {
        const normalizedId = await this.storeNormalized(
          client,
          normalized,
          rawId,
          validation,
          confidence,
          enrichmentResult
        )
        
        // Step 8: Match to user watches (if enabled)
        if (this.watchMatcher) {
          try {
            await this.watchMatcher.matchListing(normalized)
          } catch (error) {
            console.warn('[StagingPipeline] Watch matching failed:', error)
            // Continue without watch matching
          }
        }
        
        await client.query('COMMIT')
        return {
          success: true,
          rawListingId: rawId,
          normalizedListingId: normalizedId,
          warnings: validation.warnings,
          confidence,
        }
      } else {
        // Mark as failed (low confidence or validation errors)
        await this.markAsFailed(client, rawId, validation.errors)
        
        await client.query('COMMIT')
        return {
          success: false,
          rawListingId: rawId,
          errors: validation.errors,
          warnings: validation.warnings,
          confidence,
        }
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  
  private async storeRaw(client: any, raw: RawListing): Promise<string> {
    const result = await client.query(
      `INSERT INTO auction_monitor.raw_listings (
        platform, external_id, url, raw_data, ingestion_status
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (platform, external_id) DO UPDATE SET
        raw_data = EXCLUDED.raw_data,
        ingestion_status = 'pending',
        ingested_at = NOW()
      RETURNING id`,
      [raw.platform, raw.externalId, raw.url, JSON.stringify(raw.rawData), 'pending']
    )
    
    return result.rows[0].id
  }
  
  private async storeNormalized(
    client: any,
    normalized: NormalizedListing,
    rawId: string,
    validation: ValidationResult,
    confidence: number,
    enrichmentResult?: { discogsReleaseId?: number; catalogMatchConfidence: number } | null
  ): Promise<string> {
    const result = await client.query(
      `INSERT INTO auction_monitor.normalized_listings (
        raw_listing_id, platform, external_id, url,
        title, description, current_price, currency, condition, format,
        artist, album, catalog_number, label, year,
        seller_id, seller_name, seller_feedback_score, seller_location,
        listing_type, starting_price, buy_it_now_price, bid_count, watcher_count,
        time_remaining, end_date,
        shipping_cost, shipping_location, estimated_total,
        proxy_service, proxy_fee, consolidation_fee, international_shipping,
        images, thumbnail_url,
        location_restrictions, payment_restrictions, review_restrictions,
        confidence_score, completeness_score, data_quality_flags,
        discogs_release_id, catalog_match_confidence
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43
      )
      ON CONFLICT (platform, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        current_price = EXCLUDED.current_price,
        currency = EXCLUDED.currency,
        condition = EXCLUDED.condition,
        format = EXCLUDED.format,
        artist = EXCLUDED.artist,
        album = EXCLUDED.album,
        catalog_number = EXCLUDED.catalog_number,
        label = EXCLUDED.label,
        year = EXCLUDED.year,
        seller_id = EXCLUDED.seller_id,
        seller_name = EXCLUDED.seller_name,
        seller_feedback_score = EXCLUDED.seller_feedback_score,
        seller_location = EXCLUDED.seller_location,
        listing_type = EXCLUDED.listing_type,
        starting_price = EXCLUDED.starting_price,
        buy_it_now_price = EXCLUDED.buy_it_now_price,
        bid_count = EXCLUDED.bid_count,
        watcher_count = EXCLUDED.watcher_count,
        time_remaining = EXCLUDED.time_remaining,
        end_date = EXCLUDED.end_date,
        shipping_cost = EXCLUDED.shipping_cost,
        shipping_location = EXCLUDED.shipping_location,
        estimated_total = EXCLUDED.estimated_total,
        proxy_service = EXCLUDED.proxy_service,
        proxy_fee = EXCLUDED.proxy_fee,
        consolidation_fee = EXCLUDED.consolidation_fee,
        international_shipping = EXCLUDED.international_shipping,
        images = EXCLUDED.images,
        thumbnail_url = EXCLUDED.thumbnail_url,
        location_restrictions = EXCLUDED.location_restrictions,
        payment_restrictions = EXCLUDED.payment_restrictions,
        review_restrictions = EXCLUDED.review_restrictions,
        confidence_score = EXCLUDED.confidence_score,
        completeness_score = EXCLUDED.completeness_score,
        data_quality_flags = EXCLUDED.data_quality_flags,
        discogs_release_id = EXCLUDED.discogs_release_id,
        catalog_match_confidence = EXCLUDED.catalog_match_confidence,
        updated_at = NOW(),
        last_seen_at = NOW()
      RETURNING id`,
      [
        rawId, normalized.platform, normalized.externalId, normalized.url,
        normalized.title, normalized.description, normalized.currentPrice, normalized.currency,
        normalized.condition, normalized.format,
        normalized.artist, normalized.album, normalized.catalogNumber, normalized.label, normalized.year,
        normalized.sellerId, normalized.sellerName, normalized.sellerFeedbackScore, normalized.sellerLocation,
        normalized.listingType, normalized.startingPrice, normalized.buyItNowPrice,
        normalized.bidCount, normalized.watcherCount, normalized.timeRemaining, normalized.endDate,
        normalized.shippingCost, normalized.shippingLocation, normalized.estimatedTotal,
        normalized.proxyService, normalized.proxyFee, normalized.consolidationFee, normalized.internationalShipping,
        normalized.images ? JSON.stringify(normalized.images) : null, normalized.thumbnailUrl,
        normalized.locationRestrictions ? JSON.stringify(normalized.locationRestrictions) : null,
        normalized.paymentRestrictions ? JSON.stringify(normalized.paymentRestrictions) : null,
        normalized.reviewRestrictions ? JSON.stringify(normalized.reviewRestrictions) : null,
        confidence, validation.completeness,
        validation.warnings.length > 0 ? JSON.stringify(validation.warnings) : null,
        enrichmentResult?.discogsReleaseId || null, // discogs_release_id (from enrichment)
        enrichmentResult?.catalogMatchConfidence || null, // catalog_match_confidence
      ]
    )
    
    // Update raw_listing status
    await client.query(
      'UPDATE auction_monitor.raw_listings SET ingestion_status = $1, processed_at = NOW() WHERE id = $2',
      ['validated', rawId]
    )
    
    return result.rows[0].id
  }
  
  private async markAsFailed(client: any, rawId: string, errors: string[]): Promise<void> {
    await client.query(
      `UPDATE auction_monitor.raw_listings 
       SET ingestion_status = 'failed', 
           validation_errors = $1,
           processed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(errors), rawId]
    )
  }
  
  private async findDuplicates(client: any, normalized: NormalizedListing): Promise<Array<{ id: string }>> {
    // Check for exact match (platform + external_id)
    const exactMatch = await client.query(
      'SELECT id FROM auction_monitor.normalized_listings WHERE platform = $1 AND external_id = $2',
      [normalized.platform, normalized.externalId]
    )
    
    if (exactMatch.rows.length > 0) {
      return exactMatch.rows
    }
    
    // Check for URL match (normalized URLs)
    const urlMatch = await client.query(
      'SELECT id FROM auction_monitor.normalized_listings WHERE url = $1',
      [normalized.url]
    )
    
    if (urlMatch.rows.length > 0) {
      return urlMatch.rows
    }
    
    // TODO: Implement fuzzy matching using pg_trgm
    // For now, return empty array
    return []
  }
  
  /**
   * Calculate confidence score (0.0-1.0) for a normalized listing
   * Multi-factor scoring:
   * - Completeness: Percentage of required/important fields populated
   * - Source Reliability: Platform-specific reliability (APIs=0.95, scraping=0.70-0.75)
   * - Validation Errors: 10% penalty per error
   * - Warnings: 5% penalty per warning (smaller impact)
   * 
   * Thresholds:
   * - ≥0.7: High confidence, fed to Analytics Service
   * - 0.5-0.7: Medium confidence, stored but not analyzed
   * - <0.5: Low confidence, stored in raw_listings only
   */
  private calculateConfidence(
    normalized: NormalizedListing,
    validation: ValidationResult,
    enrichmentResult?: { discogsReleaseId?: number; catalogMatchConfidence: number } | null
  ): number {
    let score = 1.0
    
    // Completeness penalty (0.0-1.0)
    score *= validation.completeness
    
    // Source reliability (platform-specific)
    const sourceReliability: Record<string, number> = {
      'ebay': 0.95,      // Official API, high reliability
      'discogs': 0.95,   // Official API, high reliability
      'buyee': 0.75,     // Scraping, medium reliability
      'yahoojp': 0.75,   // Scraping, medium reliability
      'carousellhk': 0.70, // Scraping, lower reliability
      'recordcity': 0.70,  // Scraping, lower reliability
    }
    score *= sourceReliability[normalized.platform] || 0.5
    
    // Validation errors penalty (10% per error)
    score *= Math.max(0, 1 - (validation.errors.length * 0.1))
    
    // Warnings penalty (5% per warning, smaller impact)
    score *= Math.max(0.9, 1 - (validation.warnings.length * 0.05))
    
    // Enrichment bonus (if Discogs catalog match found)
    if (enrichmentResult?.discogsReleaseId) {
      // Boost confidence by catalog match confidence (up to 10% bonus)
      score *= (1 + enrichmentResult.catalogMatchConfidence * 0.1)
    }
    
    return Math.min(1.0, Math.max(0.0, score))
  }
}

