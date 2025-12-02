/**
 * Validation Engine
 * 
 * Validates normalized listings to ensure data quality before storage.
 * Performs:
 * - Required field validation (title, price, URL, external ID)
 * - Data type validation (positive prices, non-negative counts)
 * - Business rule validation (price relationships, date validity)
 * - Completeness scoring (0.0-1.0 based on field population)
 * 
 * Only listings that pass validation (valid=true, confidence≥0.5) are stored
 * in normalized_listings table and fed to Analytics Service.
 */

import type { NormalizedListing } from '../normalizers/listing-normalizer'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  completeness: number  // 0.0 to 1.0
}

export class ListingValidator {
  validate(normalized: NormalizedListing): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    
    // Required fields
    if (!normalized.title || normalized.title.trim().length === 0) {
      errors.push('Title is required')
    }
    
    if (normalized.currentPrice === undefined || normalized.currentPrice === null) {
      errors.push('Price is required')
    }
    
    if (!normalized.url || normalized.url.trim().length === 0) {
      errors.push('URL is required')
    }
    
    if (!normalized.externalId || normalized.externalId.trim().length === 0) {
      errors.push('External ID is required')
    }
    
    // Data type validation
    if (normalized.currentPrice !== undefined && normalized.currentPrice <= 0) {
      errors.push('Price must be positive')
    }
    
    if (normalized.bidCount < 0) {
      errors.push('Bid count cannot be negative')
    }
    
    if (normalized.watcherCount < 0) {
      errors.push('Watcher count cannot be negative')
    }
    
    // Business rules
    if (normalized.buyItNowPrice && normalized.buyItNowPrice < normalized.currentPrice) {
      warnings.push('Buy it now price is less than current price')
    }
    
    if (normalized.startingPrice && normalized.startingPrice > normalized.currentPrice) {
      warnings.push('Starting price is greater than current price')
    }
    
    if (normalized.endDate && normalized.endDate < new Date()) {
      warnings.push('End date is in the past')
    }
    
    // Currency validation
    const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'CAD', 'AUD']
    if (normalized.currency && !validCurrencies.includes(normalized.currency)) {
      warnings.push(`Currency ${normalized.currency} may not be supported`)
    }
    
    // URL validation
    if (normalized.url) {
      try {
        new URL(normalized.url)
      } catch {
        errors.push('URL is invalid')
      }
    }
    
    // Completeness scoring
    const completeness = this.calculateCompleteness(normalized)
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      completeness,
    }
  }
  
  /**
   * Calculate completeness score (0.0-1.0)
   * Weighted scoring:
   * - Core fields (required): 4 points
   * - Catalog information (important): 3 points
   * - Condition/format (important): 2 points
   * - Seller information (nice to have): 2 points
   * - Images (nice to have): 1 point
   * - Description (nice to have): 1 point
   * Total: 13 points maximum
   */
  private calculateCompleteness(normalized: NormalizedListing): number {
    let score = 0
    let maxScore = 0
    
    // Core fields (required) - 4 points
    maxScore += 4
    if (normalized.title) score += 1
    if (normalized.currentPrice !== undefined) score += 1
    if (normalized.url) score += 1
    if (normalized.externalId) score += 1
    
    // Catalog information (important) - 3 points
    maxScore += 3
    if (normalized.artist) score += 1
    if (normalized.album) score += 1
    if (normalized.catalogNumber) score += 1
    
    // Condition and format (important) - 2 points
    maxScore += 2
    if (normalized.condition) score += 1
    if (normalized.format) score += 1
    
    // Seller information (nice to have) - 2 points
    maxScore += 2
    if (normalized.sellerName) score += 1
    if (normalized.sellerFeedbackScore !== undefined) score += 1
    
    // Images (nice to have) - 1 point
    maxScore += 1
    if (normalized.images && normalized.images.length > 0) score += 1
    
    // Description (nice to have) - 1 point
    maxScore += 1
    if (normalized.description) score += 1
    
    return maxScore > 0 ? score / maxScore : 0
  }
}

