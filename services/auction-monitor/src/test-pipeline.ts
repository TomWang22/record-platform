/**
 * Simple Pipeline Test Script
 * 
 * Tests the auction monitor pipeline without requiring a test framework.
 * Run with: tsx src/test-pipeline.ts
 */

import { Pool } from 'pg'
import { StagingPipeline } from './pipeline/staging-pipeline'
import type { RawListing } from './platforms/base/adapter'

const POSTGRES_URL = process.env.POSTGRES_URL_AUCTION_MONITOR || process.env.POSTGRES_URL || ''

async function testPipeline() {
  if (!POSTGRES_URL) {
    console.error('❌ POSTGRES_URL_AUCTION_MONITOR not set')
    console.log('Set POSTGRES_URL_AUCTION_MONITOR to test the pipeline')
    process.exit(1)
  }

  console.log('🧪 Testing Auction Monitor Pipeline...\n')

  const pool = new Pool({ connectionString: POSTGRES_URL })
  const pipeline = new StagingPipeline(pool, {
    discogsToken: process.env.DISCOGS_USER_TOKEN,
    enableWatchMatching: false,  // Disable for simple test
  })

  try {
    // Test 1: Valid listing
    console.log('Test 1: Processing valid listing...')
    const validListing: RawListing = {
      platform: 'ebay',
      externalId: `test-${Date.now()}`,
      url: 'https://ebay.com/item/test-123',
      title: 'The Beatles - Abbey Road',
      price: 25.99,
      currency: 'USD',
      condition: 'Very Good',
      format: 'LP',
      artist: 'The Beatles',
      album: 'Abbey Road',
      catalogNumber: 'SO-383',
      rawData: {
        test: true,
      },
    }

    const result1 = await pipeline.processRawListing(validListing)
    
    if (result1.success) {
      console.log('✅ Valid listing processed successfully')
      console.log(`   Raw ID: ${result1.rawListingId}`)
      console.log(`   Normalized ID: ${result1.normalizedListingId}`)
      console.log(`   Confidence: ${result1.confidence?.toFixed(2)}`)
    } else {
      console.log('❌ Valid listing failed')
      console.log(`   Errors: ${result1.errors?.join(', ')}`)
    }

    // Test 2: Invalid listing (missing required fields)
    console.log('\nTest 2: Processing invalid listing...')
    const invalidListing: RawListing = {
      platform: 'ebay',
      externalId: '',  // Missing
      url: '',  // Missing
      title: '',  // Missing
      price: -10,  // Invalid
      currency: 'USD',
      rawData: {},
    }

    const result2 = await pipeline.processRawListing(invalidListing)
    
    if (!result2.success) {
      console.log('✅ Invalid listing correctly rejected')
      console.log(`   Errors: ${result2.errors?.join(', ')}`)
    } else {
      console.log('❌ Invalid listing was accepted (should be rejected)')
    }

    // Test 3: Check database
    console.log('\nTest 3: Checking database...')
    const dbCheck = await pool.query(
      'SELECT COUNT(*) as count FROM auction_monitor.raw_listings WHERE platform = $1',
      ['ebay']
    )
    console.log(`✅ Database accessible: ${dbCheck.rows[0].count} raw listings found`)

    console.log('\n✅ All tests completed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

testPipeline().catch(console.error)

