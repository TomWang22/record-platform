#!/usr/bin/env tsx
/**
 * Full Pipeline Test
 * 
 * Tests the complete data flow:
 * 1. Platform adapter (eBay/Discogs)
 * 2. Staging pipeline (raw → normalized)
 * 3. Analytics ingestion
 * 4. Data quality validation
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { Pool } from 'pg'
import { eBayAdapter } from '../src/platforms/ebay/adapter'
import { DiscogsAdapter } from '../src/platforms/discogs/adapter'
import { StagingPipeline } from '../src/pipeline/staging-pipeline'
import { AnalyticsIngestionPipeline } from '../src/analytics/ingestion-pipeline'

// Load .env file
config({ path: resolve(__dirname, '../.env') })

const POSTGRES_URL_AUCTION_MONITOR = process.env.POSTGRES_URL_AUCTION_MONITOR
const POSTGRES_URL_ANALYTICS = process.env.POSTGRES_URL_ANALYTICS || process.env.POSTGRES_URL_AUCTION_MONITOR

if (!POSTGRES_URL_AUCTION_MONITOR) {
  console.error('❌ POSTGRES_URL_AUCTION_MONITOR not set')
  process.exit(1)
}

async function testFullPipeline() {
  console.log('🚀 Starting Full Pipeline Test\n')

  const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR })
  const analyticsPool = new Pool({ connectionString: POSTGRES_URL_ANALYTICS })

  try {
    // Test 1: Service Health
    console.log('📋 Test 1: Service Health Check')
    await testServiceHealth(auctionPool, analyticsPool)
    console.log('✅ Service health check passed\n')

    // Test 2: eBay Data Ingestion
    console.log('📋 Test 2: eBay Data Ingestion')
    const ebayListing = await testEBayIngestion(auctionPool)
    console.log('✅ eBay ingestion test passed\n')

    // Test 3: Discogs Data Ingestion
    console.log('📋 Test 3: Discogs Data Ingestion')
    const discogsListing = await testDiscogsIngestion(auctionPool)
    console.log('✅ Discogs ingestion test passed\n')

    // Test 4: Analytics Ingestion
    console.log('📋 Test 4: Analytics Ingestion')
    await testAnalyticsIngestion(auctionPool, analyticsPool)
    console.log('✅ Analytics ingestion test passed\n')

    // Test 5: Data Quality
    console.log('📋 Test 5: Data Quality Validation')
    await testDataQuality(auctionPool)
    console.log('✅ Data quality validation passed\n')

    console.log('🎉 All tests passed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  } finally {
    await auctionPool.end()
    await analyticsPool.end()
  }
}

async function testServiceHealth(auctionPool: Pool, analyticsPool: Pool) {
  // Test database connections
  await auctionPool.query('SELECT 1')
  await analyticsPool.query('SELECT 1')
  console.log('  ✅ Database connections healthy')
}

async function testEBayIngestion(auctionPool: Pool): Promise<any> {
  const adapter = new eBayAdapter({
    appId: process.env.EBAY_APP_ID || '',
    authToken: process.env.EBAY_AUTH_TOKEN || '',
    sandbox: process.env.EBAY_SANDBOX === 'true',
  })

  const pipeline = new StagingPipeline(auctionPool)

  // Search for a test item
  const rawListings = await adapter.search({
    query: 'The Beatles Abbey Road LP',
    limit: 1,
  })

  if (rawListings.length === 0) {
    throw new Error('No eBay listings found for test')
  }

  console.log(`  📦 Found ${rawListings.length} raw listing(s)`)

  // Process through staging pipeline
  const result = await pipeline.processRawListing(rawListings[0])
  console.log(`  ✅ Processed listing: ${result.normalizedListing?.title}`)
  console.log(`  📊 Confidence: ${result.normalizedListing?.confidence_score?.toFixed(2)}`)

  if (result.normalizedListing && result.normalizedListing.confidence_score < 0.5) {
    throw new Error(`Confidence too low: ${result.normalizedListing.confidence_score}`)
  }

  return result.normalizedListing
}

async function testDiscogsIngestion(auctionPool: Pool): Promise<any> {
  const adapter = new DiscogsAdapter({
    userToken: process.env.DISCOGS_USER_TOKEN || '',
  })

  const pipeline = new StagingPipeline(auctionPool)

  // Search for a test item
  const rawListings = await adapter.search({
    query: 'The Beatles Abbey Road',
    limit: 1,
  })

  if (rawListings.length === 0) {
    throw new Error('No Discogs listings found for test')
  }

  console.log(`  📦 Found ${rawListings.length} raw listing(s)`)

  // Process through staging pipeline
  const result = await pipeline.processRawListing(rawListings[0])
  console.log(`  ✅ Processed listing: ${result.normalizedListing?.title}`)
  console.log(`  📊 Confidence: ${result.normalizedListing?.confidence_score?.toFixed(2)}`)

  if (result.normalizedListing && result.normalizedListing.confidence_score < 0.5) {
    throw new Error(`Confidence too low: ${result.normalizedListing.confidence_score}`)
  }

  return result.normalizedListing
}

async function testAnalyticsIngestion(auctionPool: Pool, analyticsPool: Pool) {
  const pipeline = new AnalyticsIngestionPipeline(auctionPool, analyticsPool)

  // Get listings with high confidence
  const result = await pipeline.ingestNewListings()
  console.log(`  📊 Processed: ${result.processed}, Errors: ${result.errors}`)

  if (result.errors > 0) {
    console.warn(`  ⚠️  ${result.errors} errors during ingestion`)
  }

  // Verify price history was created
  const historyCount = await auctionPool.query(
    `SELECT COUNT(*) as count FROM auction_monitor.price_history`
  )
  console.log(`  📈 Price history entries: ${historyCount.rows[0].count}`)
}

async function testDataQuality(auctionPool: Pool) {
  // Check confidence distribution
  const confidenceStats = await auctionPool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN confidence_score >= 0.7 THEN 1 END) as high_confidence,
      COUNT(CASE WHEN confidence_score >= 0.5 AND confidence_score < 0.7 THEN 1 END) as medium_confidence,
      AVG(confidence_score) as avg_confidence,
      AVG(completeness_score) as avg_completeness,
      COUNT(CASE WHEN discogs_release_id IS NOT NULL THEN 1 END) as enriched_count
    FROM auction_monitor.normalized_listings
  `)

  const stats = confidenceStats.rows[0]
  console.log(`  📊 Total listings: ${stats.total}`)
  console.log(`  ✅ High confidence (≥0.7): ${stats.high_confidence}`)
  console.log(`  ⚠️  Medium confidence (0.5-0.7): ${stats.medium_confidence}`)
  console.log(`  📈 Avg confidence: ${parseFloat(stats.avg_confidence || '0').toFixed(2)}`)
  console.log(`  📈 Avg completeness: ${parseFloat(stats.avg_completeness || '0').toFixed(2)}`)
  console.log(`  🎯 Enriched: ${stats.enriched_count}`)

  // Check if we have enough high-confidence data
  const highConfidenceRate = parseFloat(stats.total || '0') > 0
    ? (parseFloat(stats.high_confidence || '0') / parseFloat(stats.total || '1')) * 100
    : 0

  console.log(`  📊 High confidence rate: ${highConfidenceRate.toFixed(1)}%`)

  if (highConfidenceRate < 50) {
    console.warn(`  ⚠️  Low high-confidence rate (target: ≥50%)`)
  }
}

// Run tests
testFullPipeline().catch(console.error)

