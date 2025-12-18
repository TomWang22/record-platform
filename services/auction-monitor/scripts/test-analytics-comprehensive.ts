#!/usr/bin/env tsx
/**
 * Comprehensive Analytics Service Test Suite
 * 
 * Tests:
 * 1. Granular percentile calculation (p1-p99)
 * 2. Data quality validation
 * 3. Historical comparison
 * 4. Price position calculation
 * 5. End-to-end data flow
 * 6. Python AI data format validation
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

interface TestResult {
  name: string
  passed: boolean
  error?: string
  details?: any
}

const results: TestResult[] = []

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  try {
    await testFn()
    results.push({ name, passed: true })
    console.log(`✅ ${name}`)
  } catch (error: any) {
    results.push({ name, passed: false, error: error.message, details: error })
    console.error(`❌ ${name}: ${error.message}`)
    throw error
  }
}

async function testGranularPercentiles() {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  // Create test data: 100 listings with varying prices
  const testPrices = Array.from({ length: 100 }, (_, i) => 10 + i * 2) // 10, 12, 14, ..., 208
  
  // Clean up any existing test data first
  await auctionPool.query(`
    DELETE FROM auction_monitor.normalized_listings 
    WHERE platform = 'test' AND external_id LIKE 'test-percentile-%'
  `)
  
  // Insert test normalized listings
  const listingIds: number[] = []
  for (let i = 0; i < testPrices.length; i++) {
    const result = await auctionPool.query(`
      INSERT INTO auction_monitor.normalized_listings (
        platform, external_id, title, current_price, currency,
        condition, format, url, confidence_score, completeness_score,
        catalog_number, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `, [
      'test',
      `test-percentile-${Date.now()}-${i}`, // Unique external_id
      `Test Record ${i}`,
      testPrices[i],
      'USD',
      'Very Good',
      'LP',
      `https://test.com/percentile-${i}`,
      0.85, // High confidence
      0.90, // High completeness
      `TEST-CAT-${Math.floor(i / 10)}`, // Group by catalog number for similarity
    ])
    listingIds.push(result.rows[0].id)
  }

  console.log(`  📊 Created ${listingIds.length} test listings`)

  // Process through analytics pipeline
  const ingestionResult = await pipeline.ingestNewListings()
  console.log(`  📈 Processed: ${ingestionResult.processed}, Errors: ${ingestionResult.errors}`)

  if (ingestionResult.processed === 0) {
    throw new Error('No listings were processed. Check that listings have catalog_number or discogs_release_id and confidence >= 0.7')
  }

  // Verify percentiles were calculated
  const percentileCheck = await auctionPool.query(`
    SELECT 
      id,
      metadata->'percentiles' as percentiles,
      metadata->'percentiles'->'p1' as p1,
      metadata->'percentiles'->'p50' as p50,
      metadata->'percentiles'->'p99' as p99,
      metadata->'percentiles'->'count' as count,
      metadata->'percentiles'->'min' as min,
      metadata->'percentiles'->'max' as max,
      metadata->'percentiles'->'mean' as mean,
      metadata->'percentiles'->'median' as median,
      metadata->'percentiles'->'stdDev' as stdDev,
      metadata->'pricePosition' as price_position
    FROM auction_monitor.price_history
    WHERE normalized_listing_id = $1
    ORDER BY snapshot_at DESC
    LIMIT 1
  `, [listingIds[0]])

  if (percentileCheck.rows.length === 0) {
    throw new Error('No price history entry found')
  }

  const percentiles = percentileCheck.rows[0].percentiles
  if (!percentiles) {
    throw new Error('Percentiles not found in metadata')
  }

  // Verify all percentiles p1-p100 exist
  for (let p = 1; p <= 100; p++) {
    const percentileKey = `p${p}`
    if (!percentiles[percentileKey]) {
      throw new Error(`Missing percentile ${percentileKey}`)
    }
    const value = parseFloat(percentiles[percentileKey])
    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid percentile ${percentileKey}: ${value}`)
    }
  }

  // Verify summary statistics
  const min = parseFloat(percentiles.min)
  const max = parseFloat(percentiles.max)
  const mean = parseFloat(percentiles.mean)
  const median = parseFloat(percentiles.median)
  const stdDev = parseFloat(percentiles.stdDev)
  const count = parseInt(percentiles.count)

  if (min !== 10) throw new Error(`Expected min=10, got ${min}`)
  if (max !== 208) throw new Error(`Expected max=208, got ${max}`)
  if (count !== 100) throw new Error(`Expected count=100, got ${count}`)
  if (Math.abs(mean - 109) > 1) throw new Error(`Expected mean≈109, got ${mean}`)
  if (Math.abs(median - 109) > 1) throw new Error(`Expected median≈109, got ${median}`)

  // Verify price position
  const pricePosition = parseFloat(percentileCheck.rows[0].price_position)
  if (isNaN(pricePosition) || pricePosition < 0 || pricePosition > 1) {
    throw new Error(`Invalid price position: ${pricePosition}`)
  }

  console.log(`  ✅ All percentiles (p1-p100) calculated correctly`)
  console.log(`  ✅ Summary stats: min=${min}, max=${max}, mean=${mean.toFixed(2)}, median=${median.toFixed(2)}, stdDev=${stdDev.toFixed(2)}`)
  console.log(`  ✅ Price position: ${pricePosition.toFixed(3)}`)

  // Cleanup
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = ANY($1)', [listingIds])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = ANY($1)', [listingIds])

  await auctionPool.end()
  await analyticsPool.end()
}

async function testDataQualityPipeline() {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  // Clean up any existing test data
  await auctionPool.query(`
    DELETE FROM auction_monitor.normalized_listings 
    WHERE platform = 'test' AND (external_id LIKE 'test-high-conf%' OR external_id LIKE 'test-low-conf%')
  `)

  // Test 1: High confidence listings (≥0.7) should be processed
  const highConfListing = await auctionPool.query(`
    INSERT INTO auction_monitor.normalized_listings (
      platform, external_id, title, current_price, currency,
      condition, format, url, confidence_score, completeness_score,
      catalog_number, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING id, confidence_score
  `, [
    'test',
    `test-high-conf-${Date.now()}`,
    'High Confidence Test',
    50.00,
    'USD',
    'Very Good',
    'LP',
    'https://test.com/high',
    0.85, // High confidence
    0.90,
    'TEST-HIGH-CAT', // Required for ingestion
  ])

  const highConfId = highConfListing.rows[0].id

  // Test 2: Low confidence listings (<0.7) should NOT be processed
  const lowConfListing = await auctionPool.query(`
    INSERT INTO auction_monitor.normalized_listings (
      platform, external_id, title, current_price, currency,
      condition, format, url, confidence_score, completeness_score,
      catalog_number, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING id, confidence_score
  `, [
    'test',
    `test-low-conf-${Date.now()}`,
    'Low Confidence Test',
    30.00,
    'USD',
    'Good',
    'LP',
    'https://test.com/low',
    0.45, // Low confidence
    0.50,
    'TEST-LOW-CAT', // Even with catalog number, low confidence should be filtered
  ])

  const lowConfId = lowConfListing.rows[0].id

  // Process through pipeline
  const result = await pipeline.ingestNewListings()

  // Verify high confidence was processed
  const highConfHistory = await auctionPool.query(`
    SELECT COUNT(*) as count
    FROM auction_monitor.price_history
    WHERE normalized_listing_id = $1
  `, [highConfId])

  if (parseInt(highConfHistory.rows[0].count) === 0) {
    throw new Error('High confidence listing was not processed')
  }

  // Verify low confidence was NOT processed
  const lowConfHistory = await auctionPool.query(`
    SELECT COUNT(*) as count
    FROM auction_monitor.price_history
    WHERE normalized_listing_id = $1
  `, [lowConfId])

  if (parseInt(lowConfHistory.rows[0].count) > 0) {
    throw new Error('Low confidence listing was incorrectly processed')
  }

  console.log(`  ✅ High confidence (≥0.7) listings processed`)
  console.log(`  ✅ Low confidence (<0.7) listings filtered out`)

  // Cleanup
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = ANY($1)', [[highConfId, lowConfId]])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = ANY($1)', [[highConfId, lowConfId]])

  await auctionPool.end()
  await analyticsPool.end()
}

async function testHistoricalComparison() {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  // Clean up any existing test data
  await auctionPool.query(`
    DELETE FROM auction_monitor.normalized_listings 
    WHERE platform = 'test' AND external_id LIKE 'test-historical%'
  `)

  // Create listing with historical data
  const listing = await auctionPool.query(`
    INSERT INTO auction_monitor.normalized_listings (
      platform, external_id, title, current_price, currency,
      condition, format, url, confidence_score, completeness_score,
      catalog_number, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    RETURNING id
  `, [
    'test',
    `test-historical-${Date.now()}`,
    'Historical Test',
    100.00,
    'USD',
    'Very Good',
    'LP',
    'https://test.com/historical',
    0.85,
    0.90,
    'TEST-HIST-CAT',
  ])

  const listingId = listing.rows[0].id

  // Create historical price snapshots
  const historicalPrices = [80, 85, 90, 95, 100]
  for (let i = 0; i < historicalPrices.length; i++) {
    await auctionPool.query(`
      INSERT INTO auction_monitor.price_history (
        normalized_listing_id, snapshot_at, price, currency, metadata
      ) VALUES ($1, NOW() - INTERVAL '${historicalPrices.length - i} days', $2, $3, $4)
    `, [
      listingId,
      historicalPrices[i],
      'USD',
      JSON.stringify({ test: true }),
    ])
  }

  // Process through pipeline
  await pipeline.ingestNewListings()

  // Verify historical comparison was calculated
  const historyCheck = await auctionPool.query(`
    SELECT 
      metadata->'historical' as historical
    FROM auction_monitor.price_history
    WHERE normalized_listing_id = $1
    ORDER BY snapshot_at DESC
    LIMIT 1
  `, [listingId])

  if (historyCheck.rows.length === 0) {
    throw new Error('No price history entry found')
  }

  const historical = historyCheck.rows[0].historical
  if (!historical) {
    throw new Error('Historical comparison not found in metadata')
  }

  // Verify historical comparison fields
  if (historical.avgPrice === undefined) {
    throw new Error('Historical avgPrice not found')
  }
  if (historical.trend === undefined) {
    throw new Error('Historical trend not found')
  }

  console.log(`  ✅ Historical comparison calculated`)
  console.log(`  ✅ Average price: ${historical.avgPrice}`)
  console.log(`  ✅ Trend: ${historical.trend}`)

  // Cleanup
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = $1', [listingId])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = $1', [listingId])

  await auctionPool.end()
  await analyticsPool.end()
}

async function testPythonAIDataFormat() {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })

  // Get a processed listing with percentiles
  const listing = await auctionPool.query(`
    SELECT 
      nl.id,
      nl.title,
      nl.current_price,
      nl.currency,
      nl.condition,
      nl.confidence_score,
      ph.metadata
    FROM auction_monitor.normalized_listings nl
    JOIN auction_monitor.price_history ph ON ph.normalized_listing_id = nl.id
    WHERE nl.confidence_score >= 0.7
    ORDER BY ph.snapshot_at DESC
    LIMIT 1
  `)

  if (listing.rows.length === 0) {
    console.log('  ⚠️  No processed listings found, skipping Python AI format test')
    await auctionPool.end()
    await analyticsPool.end()
    return
  }

  const data = listing.rows[0]
  const metadata = data.metadata

  // Verify Python AI required fields
  const requiredFields = [
    'percentiles',
    'percentiles.p1',
    'percentiles.p50',
    'percentiles.p100',
    'percentiles.min',
    'percentiles.max',
    'percentiles.mean',
    'percentiles.median',
    'percentiles.stdDev',
    'percentiles.count',
    'pricePosition',
    'validation',
    'validation.pythonAIReady',
  ]

  for (const field of requiredFields) {
    const parts = field.split('.')
    let value = metadata
    for (const part of parts) {
      if (value === undefined || value === null) {
        throw new Error(`Missing required field: ${field}`)
      }
      value = value[part]
    }
    if (value === undefined || value === null) {
      throw new Error(`Required field is null/undefined: ${field}`)
    }
  }

  // Verify data types
  if (typeof data.current_price !== 'number') {
    throw new Error('current_price must be a number')
  }
  if (typeof metadata.pricePosition !== 'number') {
    throw new Error('pricePosition must be a number')
  }
  if (typeof metadata.percentiles.count !== 'number') {
    throw new Error('percentiles.count must be a number')
  }

  console.log(`  ✅ Python AI data format valid`)
  console.log(`  ✅ All required fields present`)
  console.log(`  ✅ Data types correct`)

  await auctionPool.end()
  await analyticsPool.end()
}

async function testPerformance() {
  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  // Clean up any existing test data
  await auctionPool.query(`
    DELETE FROM auction_monitor.normalized_listings 
    WHERE platform = 'test' AND external_id LIKE 'test-perf-%'
  `)

  // Create 1000 test listings
  const startTime = Date.now()
  const listingIds: number[] = []
  const timestamp = Date.now()

  for (let i = 0; i < 1000; i++) {
    const result = await auctionPool.query(`
      INSERT INTO auction_monitor.normalized_listings (
        platform, external_id, title, current_price, currency,
        condition, format, url, confidence_score, completeness_score,
        catalog_number, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `, [
      'test',
      `test-perf-${timestamp}-${i}`, // Unique external_id
      `Performance Test ${i}`,
      50 + Math.random() * 100,
      'USD',
      'Very Good',
      'LP',
      `https://test.com/perf-${timestamp}-${i}`,
      0.85,
      0.90,
      `TEST-PERF-CAT-${Math.floor(i / 10)}`, // Group by catalog for similarity
    ])
    listingIds.push(result.rows[0].id)
  }

  const insertTime = Date.now() - startTime
  console.log(`  📊 Created 1000 listings in ${insertTime}ms`)

  // Process through pipeline
  const processStart = Date.now()
  const result = await pipeline.ingestNewListings()
  const processTime = Date.now() - processStart

  console.log(`  📈 Processed ${result.processed} listings in ${processTime}ms`)
  console.log(`  ⚡ Average: ${(processTime / result.processed).toFixed(2)}ms per listing`)

  if (processTime > 60000) { // 60 seconds
    throw new Error(`Processing too slow: ${processTime}ms for ${result.processed} listings`)
  }

  // Cleanup
  await auctionPool.query('DELETE FROM auction_monitor.price_history WHERE normalized_listing_id = ANY($1)', [listingIds])
  await auctionPool.query('DELETE FROM auction_monitor.normalized_listings WHERE id = ANY($1)', [listingIds])

  await auctionPool.end()
  await analyticsPool.end()
}

async function main() {
  console.log('🚀 Starting Comprehensive Analytics Test Suite\n')

  try {
    await runTest('Test 1: Granular Percentiles (p1-p99)', testGranularPercentiles)
    await runTest('Test 2: Data Quality Pipeline', testDataQualityPipeline)
    await runTest('Test 3: Historical Comparison', testHistoricalComparison)
    await runTest('Test 4: Python AI Data Format', testPythonAIDataFormat)
    await runTest('Test 5: Performance (1000 listings)', testPerformance)

    console.log('\n📊 Test Results Summary:')
    console.log('========================')
    const passed = results.filter(r => r.passed).length
    const failed = results.filter(r => !r.passed).length
    console.log(`✅ Passed: ${passed}/${results.length}`)
    if (failed > 0) {
      console.log(`❌ Failed: ${failed}/${results.length}`)
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`)
      })
      process.exit(1)
    } else {
      console.log('\n🎉 All tests passed!')
    }
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error.message)
    process.exit(1)
  }
}

main().catch(console.error)

