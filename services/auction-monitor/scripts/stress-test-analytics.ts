#!/usr/bin/env tsx
/**
 * Analytics Service Stress Test
 * 
 * Hard stress testing of the analytics pipeline:
 * - Large datasets (10K, 50K, 100K listings)
 * - Percentile calculation accuracy (p1-p100)
 * - Data quality validation
 * - Python AI readiness checks
 * - Performance under load
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { Pool } from 'pg'
import { AnalyticsIngestionPipeline } from '../src/analytics/ingestion-pipeline'

// Load .env file
config({ path: resolve(__dirname, '../.env') })

const POSTGRES_URL_AUCTION_MONITOR = process.env.POSTGRES_URL_AUCTION_MONITOR
const POSTGRES_URL_ANALYTICS = process.env.POSTGRES_URL_ANALYTICS || process.env.POSTGRES_URL_AUCTION_MONITOR

if (!POSTGRES_URL_AUCTION_MONITOR) {
  console.error('❌ POSTGRES_URL_AUCTION_MONITOR not set')
  process.exit(1)
}

interface StressTestResult {
  datasetSize: number
  processed: number
  errors: number
  duration: number
  throughput: number
  percentileAccuracy: {
    p1: boolean
    p50: boolean
    p100: boolean
    allPercentiles: boolean
  }
  dataQuality: {
    avgConfidence: number
    highConfidenceRate: number
    completenessRate: number
  }
  pythonAIReady: boolean
  memoryUsage: NodeJS.MemoryUsage
}

async function generateLargeDataset(
  pool: Pool,
  size: number,
  confidence: number
): Promise<number[]> {
  const listingIds: number[] = []
  const batchSize = 500
  const timestamp = Date.now()

  console.log(`  📊 Generating ${size} listings in batches of ${batchSize}...`)

  for (let i = 0; i < size; i += batchSize) {
    const batch = []
    const currentBatchSize = Math.min(batchSize, size - i)

    for (let j = 0; j < currentBatchSize; j++) {
      const idx = i + j
      // Create realistic price distribution (normal distribution)
      const basePrice = 50
      const variance = 30
      const price = Math.max(10, basePrice + (Math.random() - 0.5) * variance * 2)
      
      batch.push({
        platform: 'test',
        external_id: `stress-test-${timestamp}-${idx}`,
        title: `Stress Test Record ${idx}`,
        current_price: Math.round(price * 100) / 100,
        currency: 'USD',
        condition: ['Very Good', 'Good', 'Fair'][Math.floor(Math.random() * 3)],
        format: 'LP',
        url: `https://test.com/stress-${timestamp}-${idx}`,
        confidence_score: confidence,
        completeness_score: 0.85 + Math.random() * 0.15,
        catalog_number: `STRESS-CAT-${Math.floor(idx / 100)}`, // Group by catalog
        artist: `Artist ${Math.floor(idx / 50)}`,
        album: `Album ${Math.floor(idx / 20)}`,
      })
    }

    const values = batch.map((_, idx) => {
      const base = idx * 12
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, NOW(), NOW())`
    }).join(', ')

    const params = batch.flatMap(b => [
      b.platform,
      b.external_id,
      b.title,
      b.current_price,
      b.currency,
      b.condition,
      b.format,
      b.url,
      b.confidence_score,
      b.completeness_score,
      b.catalog_number,
      b.artist,
      b.album,
    ])

    const result = await pool.query(`
      INSERT INTO auction_monitor.normalized_listings (
        platform, external_id, title, current_price, currency,
        condition, format, url, confidence_score, completeness_score,
        catalog_number, artist, album, created_at, updated_at
      ) VALUES ${values}
      RETURNING id
    `, params)

    listingIds.push(...result.rows.map(r => r.id))

    if ((i + batchSize) % 5000 === 0) {
      console.log(`    ✅ Generated ${Math.min(i + batchSize, size)}/${size} listings...`)
    }
  }

  return listingIds
}

async function verifyPercentileAccuracy(
  pool: Pool,
  listingIds: number[]
): Promise<{ p1: boolean; p50: boolean; p100: boolean; allPercentiles: boolean }> {
  // Get a sample of processed listings
  const sample = await pool.query(`
    SELECT 
      nl.id,
      nl.current_price,
      ph.metadata->'percentiles' as percentiles
    FROM auction_monitor.normalized_listings nl
    JOIN auction_monitor.price_history ph ON ph.normalized_listing_id = nl.id
    WHERE nl.id = ANY($1)
    ORDER BY ph.snapshot_at DESC
    LIMIT 100
  `, [listingIds.slice(0, 100)])

  if (sample.rows.length === 0) {
    return { p1: false, p50: false, p100: false, allPercentiles: false }
  }

  let p1Valid = true
  let p50Valid = true
  let p100Valid = true
  let allPercentilesValid = true

  for (const row of sample.rows) {
    const percentiles = row.percentiles
    if (!percentiles) {
      allPercentilesValid = false
      continue
    }

    // Verify p1 exists and is valid
    if (!percentiles.p1 || typeof percentiles.p1 !== 'number') {
      p1Valid = false
      allPercentilesValid = false
    }

    // Verify p50 exists and is valid
    if (!percentiles.p50 || typeof percentiles.p50 !== 'number') {
      p50Valid = false
      allPercentilesValid = false
    }

    // Verify p100 exists and is valid
    if (!percentiles.p100 || typeof percentiles.p100 !== 'number') {
      p100Valid = false
      allPercentilesValid = false
    }

    // Verify all percentiles p1-p100 exist
    for (let p = 1; p <= 100; p++) {
      const key = `p${p}`
      if (!percentiles[key] || typeof percentiles[key] !== 'number') {
        allPercentilesValid = false
        break
      }
    }

    // Verify percentile ordering (p1 <= p2 <= ... <= p100)
    for (let p = 1; p < 100; p++) {
      const current = percentiles[`p${p}`]
      const next = percentiles[`p${p + 1}`]
      if (current > next) {
        allPercentilesValid = false
        break
      }
    }

    // Verify min <= p1 and p100 <= max
    if (percentiles.min > percentiles.p1 || percentiles.p100 > percentiles.max) {
      allPercentilesValid = false
    }
  }

  return { p1: p1Valid, p50: p50Valid, p100: p100Valid, allPercentiles: allPercentilesValid }
}

async function verifyDataQuality(
  pool: Pool,
  listingIds: number[]
): Promise<{ avgConfidence: number; highConfidenceRate: number; completenessRate: number }> {
  const stats = await pool.query(`
    SELECT 
      AVG(confidence_score) as avg_confidence,
      COUNT(CASE WHEN confidence_score >= 0.7 THEN 1 END)::float / COUNT(*) as high_conf_rate,
      AVG(completeness_score) as avg_completeness
    FROM auction_monitor.normalized_listings
    WHERE id = ANY($1)
  `, [listingIds])

  const row = stats.rows[0]
  return {
    avgConfidence: parseFloat(row.avg_confidence || '0'),
    highConfidenceRate: parseFloat(row.high_conf_rate || '0'),
    completenessRate: parseFloat(row.avg_completeness || '0'),
  }
}

async function verifyPythonAIReadiness(
  pool: Pool,
  listingIds: number[]
): Promise<boolean> {
  // Check if processed listings have all required fields for Python AI
  const check = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN 
        ph.metadata->'percentiles'->'p1' IS NOT NULL AND
        ph.metadata->'percentiles'->'p50' IS NOT NULL AND
        ph.metadata->'percentiles'->'p100' IS NOT NULL AND
        ph.metadata->'percentiles'->'min' IS NOT NULL AND
        ph.metadata->'percentiles'->'max' IS NOT NULL AND
        ph.metadata->'percentiles'->'mean' IS NOT NULL AND
        ph.metadata->'percentiles'->'median' IS NOT NULL AND
        ph.metadata->'percentiles'->'stdDev' IS NOT NULL AND
        ph.metadata->'percentiles'->'count' IS NOT NULL AND
        ph.metadata->'pricePosition' IS NOT NULL AND
        nl.confidence_score >= 0.7
      THEN 1 END) as ready
    FROM auction_monitor.normalized_listings nl
    JOIN auction_monitor.price_history ph ON ph.normalized_listing_id = nl.id
    WHERE nl.id = ANY($1)
  `, [listingIds])

  const total = parseInt(check.rows[0].total)
  const ready = parseInt(check.rows[0].ready)
  const readinessRate = total > 0 ? ready / total : 0

  // Python AI ready if ≥95% of processed listings have all required fields
  return readinessRate >= 0.95
}

async function runStressTest(size: number): Promise<StressTestResult> {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`🔥 STRESS TEST: ${size.toLocaleString()} listings`)
  console.log('='.repeat(60))

  // Generate test data
  const generateStart = Date.now()
  const listingIds = await generateLargeDataset(auctionPool, size, 0.85)
  const generateTime = Date.now() - generateStart
  console.log(`✅ Generated ${listingIds.length} listings in ${(generateTime / 1000).toFixed(2)}s`)

  // Measure memory before
  const memoryBefore = process.memoryUsage()

  // Run analytics ingestion
  console.log(`\n🚀 Starting analytics ingestion...`)
  const startTime = Date.now()
  const result = await pipeline.ingestNewListings()
  const endTime = Date.now()
  const duration = endTime - startTime

  // Measure memory after
  const memoryAfter = process.memoryUsage()

  // Verify results
  console.log(`\n🔍 Verifying results...`)
  const percentileAccuracy = await verifyPercentileAccuracy(pool, listingIds)
  const dataQuality = await verifyDataQuality(pool, listingIds)
  const pythonAIReady = await verifyPythonAIReadiness(pool, listingIds)

  // Calculate metrics
  const throughput = (result.processed / duration) * 1000

  // Cleanup
  console.log(`\n🧹 Cleaning up...`)
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = ANY($1)', [listingIds])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = ANY($1)', [listingIds])

  await auctionPool.end()
  await analyticsPool.end()

  return {
    datasetSize: size,
    processed: result.processed,
    errors: result.errors,
    duration,
    throughput,
    percentileAccuracy,
    dataQuality,
    pythonAIReady,
    memoryUsage: {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
      external: memoryAfter.external - memoryBefore.external,
      arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    },
  }
}

async function main() {
  console.log('🔥 Analytics Service Stress Test Suite')
  console.log('Testing pipeline with large datasets and rigorous validation\n')

  const testSizes = [1000, 5000, 10000, 50000, 100000]
  const results: StressTestResult[] = []

  for (const size of testSizes) {
    try {
      const result = await runStressTest(size)
      results.push(result)

      console.log(`\n📊 Results for ${size.toLocaleString()} listings:`)
      console.log(`   Processed: ${result.processed}/${size}`)
      console.log(`   Errors: ${result.errors}`)
      console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`)
      console.log(`   Throughput: ${result.throughput.toFixed(2)} listings/sec`)
      console.log(`   Memory Delta: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`)
      console.log(`\n   Percentile Accuracy:`)
      console.log(`     p1: ${result.percentileAccuracy.p1 ? '✅' : '❌'}`)
      console.log(`     p50: ${result.percentileAccuracy.p50 ? '✅' : '❌'}`)
      console.log(`     p100: ${result.percentileAccuracy.p100 ? '✅' : '❌'}`)
      console.log(`     All p1-p100: ${result.percentileAccuracy.allPercentiles ? '✅' : '❌'}`)
      console.log(`\n   Data Quality:`)
      console.log(`     Avg Confidence: ${result.dataQuality.avgConfidence.toFixed(3)}`)
      console.log(`     High Confidence Rate: ${(result.dataQuality.highConfidenceRate * 100).toFixed(1)}%`)
      console.log(`     Completeness Rate: ${(result.dataQuality.completenessRate * 100).toFixed(1)}%`)
      console.log(`\n   Python AI Ready: ${result.pythonAIReady ? '✅ YES' : '❌ NO'}`)

      // Performance checks
      if (result.throughput < 5) {
        console.warn(`   ⚠️  Throughput below 5 listings/sec`)
      }
      if (result.errors > result.processed * 0.01) {
        console.warn(`   ⚠️  Error rate exceeds 1%`)
      }
      if (!result.pythonAIReady) {
        console.error(`   ❌ Python AI readiness check failed`)
      }
    } catch (error: any) {
      console.error(`❌ Stress test failed for ${size} listings:`, error.message)
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 STRESS TEST SUMMARY')
  console.log('='.repeat(60))

  console.log('\nThroughput (listings/sec):')
  results.forEach(r => {
    console.log(`  ${r.datasetSize.toLocaleString().padStart(8)}: ${r.throughput.toFixed(2)} listings/sec`)
  })

  console.log('\nPercentile Accuracy:')
  results.forEach(r => {
    const allValid = r.percentileAccuracy.allPercentiles
    console.log(`  ${r.datasetSize.toLocaleString().padStart(8)}: ${allValid ? '✅ All p1-p100 valid' : '❌ Failed'}`)
  })

  console.log('\nPython AI Readiness:')
  results.forEach(r => {
    console.log(`  ${r.datasetSize.toLocaleString().padStart(8)}: ${r.pythonAIReady ? '✅ Ready' : '❌ Not Ready'}`)
  })

  // Export CSV
  const csv = [
    'Dataset Size,Processed,Errors,Duration (s),Throughput (listings/sec),p1 Valid,p50 Valid,p100 Valid,All Percentiles Valid,Avg Confidence,High Conf Rate,Completeness Rate,Python AI Ready,Memory Delta (MB)',
    ...results.map(r => [
      r.datasetSize,
      r.processed,
      r.errors,
      (r.duration / 1000).toFixed(2),
      r.throughput.toFixed(2),
      r.percentileAccuracy.p1 ? 'YES' : 'NO',
      r.percentileAccuracy.p50 ? 'YES' : 'NO',
      r.percentileAccuracy.p100 ? 'YES' : 'NO',
      r.percentileAccuracy.allPercentiles ? 'YES' : 'NO',
      r.dataQuality.avgConfidence.toFixed(3),
      (r.dataQuality.highConfidenceRate * 100).toFixed(1),
      (r.dataQuality.completenessRate * 100).toFixed(1),
      r.pythonAIReady ? 'YES' : 'NO',
      (r.memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
    ].join(',')),
  ].join('\n')

  console.log(`\n📄 CSV Results:\n${csv}`)
}

main().catch(console.error)

