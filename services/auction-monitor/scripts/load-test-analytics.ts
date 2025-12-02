#!/usr/bin/env tsx
/**
 * Analytics Service Load Test
 * 
 * Simulates high-volume data ingestion to test:
 * - Analytics pipeline performance under load
 * - Database query performance
 * - Percentile calculation performance
 * - Memory usage
 * - Error handling under stress
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

interface LoadTestConfig {
  totalListings: number
  batchSize: number
  concurrentBatches: number
  targetConfidence: number
}

interface LoadTestResult {
  totalListings: number
  processed: number
  errors: number
  duration: number
  avgTimePerListing: number
  throughput: number // listings per second
  percentileCalculationTime: number
  dbQueryTime: number
  memoryUsage: NodeJS.MemoryUsage
}

async function generateTestListings(
  pool: Pool,
  count: number,
  confidence: number
): Promise<number[]> {
  const listingIds: number[] = []
  const batchSize = 100

  for (let i = 0; i < count; i += batchSize) {
    const batch = []
    for (let j = 0; j < Math.min(batchSize, count - i); j++) {
      const price = 10 + Math.random() * 200
      batch.push({
        platform: 'test',
        external_id: `load-test-${i + j}`,
        title: `Load Test Record ${i + j}`,
        current_price: price,
        currency: 'USD',
        condition: 'Very Good',
        format: 'LP',
        url: `https://test.com/load-${i + j}`,
        confidence_score: confidence,
        completeness_score: 0.90,
        catalog_number: `LOAD-TEST-CAT-${Math.floor((i + j) / 10)}`, // Group by catalog for similarity
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
    ])

    const result = await pool.query(`
      INSERT INTO auction_monitor.normalized_listings (
        platform, external_id, title, current_price, currency,
        condition, format, url, confidence_score, completeness_score,
        catalog_number, created_at, updated_at
      ) VALUES ${values}
      RETURNING id
    `, params)

    listingIds.push(...result.rows.map(r => r.id))
  }

  return listingIds
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  console.log(`\n📊 Load Test Configuration:`)
  console.log(`   Total Listings: ${config.totalListings}`)
  console.log(`   Batch Size: ${config.batchSize}`)
  console.log(`   Concurrent Batches: ${config.concurrentBatches}`)
  console.log(`   Target Confidence: ${config.targetConfidence}`)

  // Generate test data
  console.log(`\n🔄 Generating ${config.totalListings} test listings...`)
  const generateStart = Date.now()
  const listingIds = await generateTestListings(auctionPool, config.totalListings, config.targetConfidence)
  const generateTime = Date.now() - generateStart
  console.log(`✅ Generated ${listingIds.length} listings in ${generateTime}ms`)

  // Measure memory before
  const memoryBefore = process.memoryUsage()

  // Run analytics ingestion
  console.log(`\n🚀 Starting analytics ingestion...`)
  const startTime = Date.now()

  // Measure percentile calculation time
  const percentileStart = Date.now()
  const result = await pipeline.ingestNewListings()
  const percentileTime = Date.now() - percentileStart

  const endTime = Date.now()
  const duration = endTime - startTime

  // Measure memory after
  const memoryAfter = process.memoryUsage()

  // Measure database query performance
  const dbQueryStart = Date.now()
  const dbCheck = await auctionPool.query(`
    SELECT COUNT(*) as count
    FROM auction_monitor.price_history
    WHERE normalized_listing_id = ANY($1)
  `, [listingIds])
  const dbQueryTime = Date.now() - dbQueryStart

  const processed = parseInt(dbCheck.rows[0].count)

  // Calculate metrics
  const avgTimePerListing = duration / result.processed
  const throughput = (result.processed / duration) * 1000 // listings per second

  // Cleanup
  console.log(`\n🧹 Cleaning up test data...`)
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = ANY($1)', [listingIds])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = ANY($1)', [listingIds])

  await auctionPool.end()
  await analyticsPool.end()

  return {
    totalListings: config.totalListings,
    processed: result.processed,
    errors: result.errors,
    duration,
    avgTimePerListing,
    throughput,
    percentileCalculationTime: percentileTime,
    dbQueryTime,
    memoryUsage: {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
      external: memoryAfter.external - memoryBefore.external,
      arrayBuffers: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    },
  }
}

async function runLoadTestSuite() {
  console.log('🚀 Analytics Service Load Test Suite\n')
  console.log('=' .repeat(60))

  const testConfigs: LoadTestConfig[] = [
    { totalListings: 100, batchSize: 50, concurrentBatches: 1, targetConfidence: 0.85 },
    { totalListings: 500, batchSize: 100, concurrentBatches: 1, targetConfidence: 0.85 },
    { totalListings: 1000, batchSize: 100, concurrentBatches: 1, targetConfidence: 0.85 },
    { totalListings: 5000, batchSize: 500, concurrentBatches: 1, targetConfidence: 0.85 },
    { totalListings: 10000, batchSize: 1000, concurrentBatches: 1, targetConfidence: 0.85 },
  ]

  const results: LoadTestResult[] = []

  for (const config of testConfigs) {
    try {
      const result = await runLoadTest(config)
      results.push(result)

      console.log(`\n📊 Results for ${config.totalListings} listings:`)
      console.log(`   Processed: ${result.processed}/${config.totalListings}`)
      console.log(`   Errors: ${result.errors}`)
      console.log(`   Duration: ${result.duration}ms (${(result.duration / 1000).toFixed(2)}s)`)
      console.log(`   Avg Time/Listing: ${result.avgTimePerListing.toFixed(2)}ms`)
      console.log(`   Throughput: ${result.throughput.toFixed(2)} listings/sec`)
      console.log(`   Percentile Calc Time: ${result.percentileCalculationTime}ms`)
      console.log(`   DB Query Time: ${result.dbQueryTime}ms`)
      console.log(`   Memory Delta: ${(result.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`)

      // Performance thresholds
      if (result.avgTimePerListing > 100) {
        console.warn(`   ⚠️  Average time per listing exceeds 100ms`)
      }
      if (result.throughput < 10) {
        console.warn(`   ⚠️  Throughput below 10 listings/sec`)
      }
      if (result.errors > 0) {
        console.warn(`   ⚠️  ${result.errors} errors occurred`)
      }
    } catch (error: any) {
      console.error(`❌ Load test failed for ${config.totalListings} listings:`, error.message)
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 Load Test Summary')
  console.log('='.repeat(60))

  console.log('\nThroughput (listings/sec):')
  results.forEach(r => {
    console.log(`  ${r.totalListings.toString().padStart(6)} listings: ${r.throughput.toFixed(2)} listings/sec`)
  })

  console.log('\nAverage Time per Listing (ms):')
  results.forEach(r => {
    console.log(`  ${r.totalListings.toString().padStart(6)} listings: ${r.avgTimePerListing.toFixed(2)}ms`)
  })

  console.log('\nMemory Usage (MB):')
  results.forEach(r => {
    console.log(`  ${r.totalListings.toString().padStart(6)} listings: ${(r.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`)
  })

  // Export results to CSV
  const csv = [
    'Total Listings,Processed,Errors,Duration (ms),Avg Time/Listing (ms),Throughput (listings/sec),Percentile Calc Time (ms),DB Query Time (ms),Memory Delta (MB)',
    ...results.map(r => [
      r.totalListings,
      r.processed,
      r.errors,
      r.duration,
      r.avgTimePerListing.toFixed(2),
      r.throughput.toFixed(2),
      r.percentileCalculationTime,
      r.dbQueryTime,
      (r.memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
    ].join(',')),
  ].join('\n')

  console.log(`\n📄 CSV Results:\n${csv}`)
}

runLoadTestSuite().catch(console.error)

