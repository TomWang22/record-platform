/**
 * API Keys Test Script
 * 
 * Tests all API keys to verify they're working correctly.
 * Run with: npx tsx scripts/test-api-keys.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env file
config({ path: resolve(__dirname, '../.env') })

import { eBayAdapter } from '../src/platforms/ebay/adapter'
import { DiscogsAdapter } from '../src/platforms/discogs/adapter'

async function testEBay() {
  const appId = process.env.EBAY_APP_ID
  const authToken = process.env.EBAY_AUTH_TOKEN
  const sandbox = process.env.EBAY_SANDBOX === 'true'

  if (!appId || !authToken) {
    console.log('⚠️  eBay API keys not set (EBAY_APP_ID, EBAY_AUTH_TOKEN)')
    return false
  }

  try {
    console.log('🧪 Testing eBay API...')
    const adapter = new eBayAdapter({
      appId,
      authToken,
      sandbox,
    })

    const listings = await adapter.search({
      query: 'The Beatles',
      limit: 3,
    })

    if (listings.length > 0) {
      console.log(`✅ eBay API working! Found ${listings.length} listings`)
      console.log(`   Example: ${listings[0].title} - $${listings[0].price}`)
      return true
    } else {
      console.log('⚠️  eBay API returned no results (might be rate limited)')
      return false
    }
  } catch (error) {
    console.error('❌ eBay API error:', error instanceof Error ? error.message : String(error))
    return false
  }
}

async function testDiscogs() {
  const userToken = process.env.DISCOGS_USER_TOKEN

  if (!userToken) {
    console.log('⚠️  Discogs API key not set (DISCOGS_USER_TOKEN)')
    return false
  }

  try {
    console.log('🧪 Testing Discogs API...')
    const adapter = new DiscogsAdapter({
      userToken,
    })

    const listings = await adapter.search({
      query: 'The Beatles Abbey Road',
      limit: 3,
    })

    if (listings.length > 0) {
      console.log(`✅ Discogs API working! Found ${listings.length} listings`)
      console.log(`   Example: ${listings[0].title} - $${listings[0].price}`)
      return true
    } else {
      console.log('⚠️  Discogs API returned no results')
      return false
    }
  } catch (error) {
    console.error('❌ Discogs API error:', error instanceof Error ? error.message : String(error))
    return false
  }
}

async function testScrapingPlatforms() {
  console.log('🧪 Testing scraping platforms...')
  console.log('   Note: Scraping platforms (Buyee, YahooJP, CarousellHK, RecordCity)')
  console.log('   don\'t require API keys but need browser automation (Puppeteer)')
  console.log('   These will be tested when the worker runs.')
  return true
}

async function main() {
  console.log('🔑 Testing API Keys for Auction Monitor\n')

  const results = {
    ebay: await testEBay(),
    discogs: await testDiscogs(),
    scraping: await testScrapingPlatforms(),
  }

  console.log('\n📊 Test Results:')
  console.log(`   eBay: ${results.ebay ? '✅' : '❌'}`)
  console.log(`   Discogs: ${results.discogs ? '✅' : '❌'}`)
  console.log(`   Scraping: ${results.scraping ? '✅' : '⚠️'}`)

  const allWorking = results.ebay && results.discogs
  if (allWorking) {
    console.log('\n✅ All API keys are working! Ready to start the worker.')
  } else {
    console.log('\n⚠️  Some API keys are missing or invalid.')
    console.log('   See API_KEYS_SETUP.md for instructions on obtaining keys.')
  }

  process.exit(allWorking ? 0 : 1)
}

main().catch(console.error)

