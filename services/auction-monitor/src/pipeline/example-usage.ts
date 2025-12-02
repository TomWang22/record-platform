// Example usage of the Auction Monitor data pipeline
// This demonstrates how to use the platform adapters and staging pipeline

import { Pool } from 'pg'
import { eBayAdapter, DiscogsAdapter } from '../platforms'
import { StagingPipeline } from './staging-pipeline'

async function example() {
  // Initialize database connection
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL_AUCTION_MONITOR || process.env.POSTGRES_URL!,
  })
  
  // Initialize platform adapters
  const ebayAdapter = new eBayAdapter({
    appId: process.env.EBAY_APP_ID || '',
    authToken: process.env.EBAY_AUTH_TOKEN,
    sandbox: process.env.EBAY_SANDBOX === 'true',
  })
  
  const discogsAdapter = new DiscogsAdapter({
    userToken: process.env.DISCOGS_USER_TOKEN || '',
    userAgent: 'RecordPlatform/1.0',
  })
  
  // Initialize staging pipeline
  const pipeline = new StagingPipeline(pool)
  
  try {
    // Example 1: Search eBay for listings
    console.log('Searching eBay...')
    const ebayListings = await ebayAdapter.search({
      query: 'The Beatles Abbey Road',
      limit: 10,
    })
    
    console.log(`Found ${ebayListings.length} eBay listings`)
    
    // Process each listing through the pipeline
    for (const listing of ebayListings) {
      const result = await pipeline.processRawListing(listing)
      if (result.success) {
        console.log(`✅ Processed: ${listing.title} (confidence: ${result.confidence?.toFixed(2)})`)
      } else {
        console.log(`❌ Failed: ${listing.title} - ${result.errors?.join(', ')}`)
      }
    }
    
    // Example 2: Search Discogs for listings
    console.log('\nSearching Discogs...')
    const discogsListings = await discogsAdapter.search({
      query: 'The Beatles Abbey Road',
      limit: 10,
    })
    
    console.log(`Found ${discogsListings.length} Discogs listings`)
    
    // Process each listing through the pipeline
    for (const listing of discogsListings) {
      const result = await pipeline.processRawListing(listing)
      if (result.success) {
        console.log(`✅ Processed: ${listing.title} (confidence: ${result.confidence?.toFixed(2)})`)
      } else {
        console.log(`❌ Failed: ${listing.title} - ${result.errors?.join(', ')}`)
      }
    }
    
    // Example 3: Check platform health
    console.log('\nChecking platform health...')
    const ebayHealth = await ebayAdapter.healthCheck()
    console.log(`eBay: ${ebayHealth.status} (${ebayHealth.responseTime}ms)`)
    
    const discogsHealth = await discogsAdapter.healthCheck()
    console.log(`Discogs: ${discogsHealth.status} (${discogsHealth.responseTime}ms)`)
    
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await pool.end()
  }
}

// Run example if this file is executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example }

