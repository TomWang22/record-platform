/**
 * Data Validator for Analytics Pipeline
 * 
 * Ensures data quality before sending to Python AI Service.
 * Validates:
 * - Percentile completeness (p1-p100)
 * - Data type correctness
 * - Statistical validity
 * - Confidence thresholds
 */

import type { PricePercentiles } from './ingestion-pipeline'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  score: number // 0.0-1.0 quality score
}

/**
 * Validate price percentiles for Python AI consumption
 */
export function validatePercentiles(percentiles: PricePercentiles): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 1.0

  // Check all percentiles p1-p100 exist
  for (let p = 1; p <= 100; p++) {
    const key = `p${p}` as keyof PricePercentiles
    const value = percentiles[key]
    
    if (value === undefined || value === null) {
      errors.push(`Missing percentile p${p}`)
      score -= 0.01
    } else if (typeof value !== 'number') {
      errors.push(`Percentile p${p} is not a number: ${typeof value}`)
      score -= 0.01
    } else if (value < 0) {
      errors.push(`Percentile p${p} is negative: ${value}`)
      score -= 0.01
    }
  }

  // Verify percentile ordering (p1 <= p2 <= ... <= p100)
  for (let p = 1; p < 100; p++) {
    const current = (percentiles as any)[`p${p}`]
    const next = (percentiles as any)[`p${p + 1}`]
    
    if (current !== undefined && next !== undefined) {
      if (current > next) {
        errors.push(`Percentile ordering violation: p${p} (${current}) > p${p + 1} (${next})`)
        score -= 0.02
      }
    }
  }

  // Verify min <= p1 and p100 <= max
  if (percentiles.min !== undefined && percentiles.p1 !== undefined) {
    if (percentiles.min > percentiles.p1) {
      errors.push(`min (${percentiles.min}) > p1 (${percentiles.p1})`)
      score -= 0.05
    }
  }

  if (percentiles.max !== undefined && percentiles.p100 !== undefined) {
    if (percentiles.p100 > percentiles.max) {
      errors.push(`p100 (${percentiles.p100}) > max (${percentiles.max})`)
      score -= 0.05
    }
  }

  // Verify summary statistics
  if (typeof percentiles.count !== 'number' || percentiles.count < 0) {
    errors.push(`Invalid count: ${percentiles.count}`)
    score -= 0.1
  }

  if (typeof percentiles.mean !== 'number' || percentiles.mean < 0) {
    errors.push(`Invalid mean: ${percentiles.mean}`)
    score -= 0.1
  }

  if (typeof percentiles.median !== 'number' || percentiles.median < 0) {
    errors.push(`Invalid median: ${percentiles.median}`)
    score -= 0.1
  }

  if (percentiles.stdDev !== undefined) {
    if (typeof percentiles.stdDev !== 'number' || percentiles.stdDev < 0) {
      errors.push(`Invalid stdDev: ${percentiles.stdDev}`)
      score -= 0.05
    }
  } else {
    warnings.push('stdDev is missing (optional but recommended)')
    score -= 0.01
  }

  // Verify confidence level
  if (!['high', 'medium', 'low'].includes(percentiles.confidence)) {
    errors.push(`Invalid confidence: ${percentiles.confidence}`)
    score -= 0.1
  }

  // Check sample size
  if (percentiles.count < 5) {
    warnings.push(`Low sample size: ${percentiles.count} (recommended: ≥10)`)
    score -= 0.05
  }

  // Verify statistical consistency
  if (percentiles.mean !== undefined && percentiles.median !== undefined) {
    const meanMedianRatio = percentiles.mean / percentiles.median
    if (meanMedianRatio > 2 || meanMedianRatio < 0.5) {
      warnings.push(`Mean/median ratio unusual: ${meanMedianRatio.toFixed(2)} (expected: 0.8-1.2)`)
      score -= 0.02
    }
  }

  // Ensure score doesn't go below 0
  score = Math.max(0, score)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    score,
  }
}

/**
 * Validate data is ready for Python AI consumption
 */
export function validatePythonAIReadiness(
  percentiles: PricePercentiles,
  confidenceScore: number,
  completenessScore: number
): ValidationResult {
  const percentileValidation = validatePercentiles(percentiles)
  const errors: string[] = [...percentileValidation.errors]
  const warnings: string[] = [...percentileValidation.warnings]
  let score = percentileValidation.score

  // Confidence threshold check
  if (confidenceScore < 0.7) {
    errors.push(`Confidence score too low: ${confidenceScore} (required: ≥0.7)`)
    score -= 0.2
  } else if (confidenceScore < 0.8) {
    warnings.push(`Confidence score below optimal: ${confidenceScore} (optimal: ≥0.8)`)
    score -= 0.05
  }

  // Completeness check
  if (completenessScore < 0.75) {
    errors.push(`Completeness score too low: ${completenessScore} (required: ≥0.75)`)
    score -= 0.15
  } else if (completenessScore < 0.85) {
    warnings.push(`Completeness score below optimal: ${completenessScore} (optimal: ≥0.85)`)
    score -= 0.03
  }

  // Sample size check
  if (percentiles.count < 10) {
    errors.push(`Sample size too small: ${percentiles.count} (required: ≥10)`)
    score -= 0.15
  } else if (percentiles.count < 20) {
    warnings.push(`Sample size below optimal: ${percentiles.count} (optimal: ≥20)`)
    score -= 0.05
  }

  // Ensure score doesn't go below 0
  score = Math.max(0, score)

  return {
    valid: errors.length === 0 && score >= 0.8,
    errors,
    warnings,
    score,
  }
}

