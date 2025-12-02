/**
 * Watch Matcher
 * 
 * Matches normalized listings to user-defined watch criteria.
 * Implements fuzzy matching to find listings that match user searches
 * even if not exact matches (e.g., "Beatles" matches "The Beatles").
 * 
 * Stores matches in watch_matches table for notification processing.
 */

import { Pool } from 'pg'
import type { NormalizedListing } from '../normalizers/listing-normalizer'

export interface WatchCriteria {
  artist?: string
  album?: string
  title?: string
  catalogNumber?: string
  format?: string
  condition?: string
  priceRange?: {
    min?: number
    max?: number
    currency?: string
  }
  platforms?: string[]
}

export interface WatchMatch {
  watchId: string
  listingId: string
  matchScore: number  // 0.0-1.0
  matchedFields: string[]  // Which criteria matched
}

export class WatchMatcher {
  private pool: Pool
  
  constructor(pool: Pool) {
    this.pool = pool
  }
  
  /**
   * Match a normalized listing against all active user watches
   * @param listing - Normalized listing to match
   * @returns Array of watch matches
   */
  async matchListing(listing: NormalizedListing): Promise<WatchMatch[]> {
    // Get all active watches
    const watches = await this.pool.query(
      `SELECT id, search_criteria, platforms
       FROM auction_monitor.user_watches
       WHERE status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())`
    )
    
    const matches: WatchMatch[] = []
    
    for (const watch of watches.rows) {
      const criteria = watch.search_criteria as WatchCriteria
      const platforms = watch.platforms as string[] || []
      
      // Check platform match
      if (platforms.length > 0 && !platforms.includes(listing.platform)) {
        continue
      }
      
      // Calculate match score
      const matchResult = this.calculateMatchScore(listing, criteria)
      
      if (matchResult.score >= 0.5) {  // Minimum match threshold
        // Store match
        await this.storeMatch(watch.id, listing.externalId, matchResult.score, matchResult.matchedFields)
        
        matches.push({
          watchId: watch.id,
          listingId: listing.externalId,
          matchScore: matchResult.score,
          matchedFields: matchResult.matchedFields,
        })
      }
    }
    
    return matches
  }
  
  /**
   * Calculate match score between listing and watch criteria
   * Returns score (0.0-1.0) and list of matched fields
   */
  private calculateMatchScore(
    listing: NormalizedListing,
    criteria: WatchCriteria
  ): { score: number; matchedFields: string[] } {
    let score = 0.0
    let maxScore = 0.0
    const matchedFields: string[] = []
    
    // Artist match (fuzzy)
    if (criteria.artist) {
      maxScore += 0.3
      if (listing.artist) {
        const artistMatch = this.fuzzyMatch(criteria.artist, listing.artist)
        if (artistMatch >= 0.7) {
          score += 0.3 * artistMatch
          matchedFields.push('artist')
        }
      }
    }
    
    // Album/title match (fuzzy)
    if (criteria.album || criteria.title) {
      maxScore += 0.3
      const searchTerm = criteria.album || criteria.title || ''
      if (listing.album || listing.title) {
        const albumMatch = this.fuzzyMatch(searchTerm, listing.album || listing.title || '')
        if (albumMatch >= 0.7) {
          score += 0.3 * albumMatch
          matchedFields.push('album')
        }
      }
    }
    
    // Catalog number match (exact)
    if (criteria.catalogNumber) {
      maxScore += 0.2
      if (listing.catalogNumber) {
        if (listing.catalogNumber.toLowerCase() === criteria.catalogNumber.toLowerCase()) {
          score += 0.2
          matchedFields.push('catalogNumber')
        }
      }
    }
    
    // Format match (exact)
    if (criteria.format) {
      maxScore += 0.1
      if (listing.format) {
        if (listing.format.toLowerCase() === criteria.format.toLowerCase()) {
          score += 0.1
          matchedFields.push('format')
        }
      }
    }
    
    // Condition match (exact)
    if (criteria.condition) {
      maxScore += 0.1
      if (listing.condition) {
        if (listing.condition.toLowerCase() === criteria.condition.toLowerCase()) {
          score += 0.1
          matchedFields.push('condition')
        }
      }
    }
    
    // Price range match
    if (criteria.priceRange) {
      maxScore += 0.1
      const { min, max, currency } = criteria.priceRange
      const listingPrice = this.convertCurrency(listing.currentPrice, listing.currency, currency || 'USD')
      
      if ((!min || listingPrice >= min) && (!max || listingPrice <= max)) {
        score += 0.1
        matchedFields.push('priceRange')
      }
    }
    
    // Normalize score to 0.0-1.0
    const normalizedScore = maxScore > 0 ? score / maxScore : 0.0
    
    return {
      score: normalizedScore,
      matchedFields,
    }
  }
  
  /**
   * Simple fuzzy string matching (Levenshtein-like)
   * Returns similarity score 0.0-1.0
   */
  private fuzzyMatch(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim()
    const s2 = str2.toLowerCase().trim()
    
    // Exact match
    if (s1 === s2) return 1.0
    
    // Contains match
    if (s1.includes(s2) || s2.includes(s1)) return 0.8
    
    // Word-based matching
    const words1 = s1.split(/\s+/)
    const words2 = s2.split(/\s+/)
    
    let matches = 0
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1 === word2) {
          matches++
          break
        }
        if (word1.includes(word2) || word2.includes(word1)) {
          matches += 0.5
          break
        }
      }
    }
    
    return matches / Math.max(words1.length, words2.length)
  }
  
  /**
   * Convert currency (simple implementation)
   * In production, use a currency conversion API
   */
  private convertCurrency(amount: number, from: string, to: string): number {
    if (from === to) return amount
    
    // Simple conversion rates (should use real-time rates in production)
    const rates: Record<string, number> = {
      'USD': 1.0,
      'EUR': 0.92,
      'GBP': 0.79,
      'JPY': 150.0,
      'HKD': 7.8,
    }
    
    const fromRate = rates[from] || 1.0
    const toRate = rates[to] || 1.0
    
    return (amount / fromRate) * toRate
  }
  
  /**
   * Store watch match in database
   */
  private async storeMatch(
    watchId: string,
    listingExternalId: string,
    matchScore: number,
    matchedFields: string[]
  ): Promise<void> {
    // Get normalized_listing_id from external_id
    const listingResult = await this.pool.query(
      'SELECT id FROM auction_monitor.normalized_listings WHERE external_id = $1 AND platform = $2',
      [listingExternalId, listingExternalId.split(':')[0]]  // Extract platform from external_id if needed
    )
    
    if (listingResult.rows.length === 0) {
      console.warn(`[WatchMatcher] Listing not found: ${listingExternalId}`)
      return
    }
    
    const listingId = listingResult.rows[0].id
    
    // Insert or update match
    await this.pool.query(
      `INSERT INTO auction_monitor.watch_matches (watch_id, normalized_listing_id, match_score)
       VALUES ($1, $2, $3)
       ON CONFLICT (watch_id, normalized_listing_id) DO UPDATE SET
         match_score = EXCLUDED.match_score,
         created_at = NOW()`,
      [watchId, listingId, matchScore]
    )
  }
  
  /**
   * Get unmatched watches for a listing (for testing/debugging)
   */
  async getUnmatchedWatches(listing: NormalizedListing): Promise<Array<{ id: string; criteria: WatchCriteria }>> {
    const watches = await this.pool.query(
      `SELECT id, search_criteria
       FROM auction_monitor.user_watches
       WHERE status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())`
    )
    
    const unmatched: Array<{ id: string; criteria: WatchCriteria }> = []
    
    for (const watch of watches.rows) {
      const criteria = watch.search_criteria as WatchCriteria
      const matchResult = this.calculateMatchScore(listing, criteria)
      
      if (matchResult.score < 0.5) {
        unmatched.push({
          id: watch.id,
          criteria,
        })
      }
    }
    
    return unmatched
  }
}

