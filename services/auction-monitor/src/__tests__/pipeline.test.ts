/**
 * Pipeline Tests
 * 
 * Integration tests for the auction monitor data pipeline.
 * Tests the complete flow: raw → normalized → validated → enriched → stored
 * 
 * Note: These tests require Jest or similar test framework.
 * Run with: npm test (after installing @types/jest)
 */

import { Pool } from 'pg'
import { StagingPipeline } from '../pipeline/staging-pipeline'
import { eBayAdapter } from '../platforms/ebay/adapter'
import { DiscogsAdapter } from '../platforms/discogs/adapter'

// Mock database connection (use test database in actual tests)
const TEST_DB_URL = process.env.TEST_POSTGRES_URL || process.env.POSTGRES_URL_AUCTION_MONITOR || ''

// Test framework globals (Jest/Mocha)
declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: (value: any) => {
  toBe: (expected: any) => void
  toHaveProperty: (prop: string) => void
  toBeGreaterThanOrEqual: (expected: number) => void
  toBeDefined: () => void
  toBeGreaterThan: (expected: number) => void
}
declare const beforeAll: (fn: () => void | Promise<void>) => void
declare const afterAll: (fn: () => void | Promise<void>) => void

describe('Auction Monitor Pipeline', () => {
  let pool: Pool
  let pipeline: StagingPipeline
  
  beforeAll(async () => {
    if (!TEST_DB_URL) {
      console.warn('TEST_POSTGRES_URL not set, skipping database tests')
      return
    }
    
    pool = new Pool({ connectionString: TEST_DB_URL })
    pipeline = new StagingPipeline(pool, {
      discogsToken: process.env.DISCOGS_USER_TOKEN,
      enableWatchMatching: true,
    })
  })
  
  afterAll(async () => {
    if (pool) {
      await pool.end()
    }
  })
  
  describe('eBay Adapter', () => {
    it('should search eBay listings', async () => {
      const adapter = new eBayAdapter({
        appId: process.env.EBAY_APP_ID || 'test-app-id',
        authToken: process.env.EBAY_AUTH_TOKEN || 'test-token',
        sandbox: true,
      })
      
      const listings = await adapter.search({
        query: 'The Beatles Abbey Road',
        limit: 5,
      })
      
      expect(listings.length).toBeGreaterThan(0)
      expect(listings[0].platform).toBe('ebay')
      expect(listings[0].title).toBeDefined()
      expect(listings[0].price).toBeDefined()
      expect(listings[0].url).toBeDefined()
    })
    
    it('should process eBay listing through pipeline', async () => {
      if (!TEST_DB_URL) {
        console.warn('Skipping pipeline test - no test database')
        return
      }
      
      const adapter = new eBayAdapter({
        appId: process.env.EBAY_APP_ID || 'test-app-id',
        authToken: process.env.EBAY_AUTH_TOKEN || 'test-token',
        sandbox: true,
      })
      
      const listings = await adapter.search({
        query: 'The Beatles',
        limit: 1,
      })
      
      if (listings.length > 0) {
        const result = await pipeline.processRawListing(listings[0])
        
        expect(result).toHaveProperty('success')
        if (result.success) {
          expect(result.normalizedListingId).toBeDefined()
          expect(result.confidence).toBeGreaterThanOrEqual(0.5)
        }
      }
    })
  })
  
  describe('Discogs Adapter', () => {
    it('should search Discogs listings', async () => {
      const adapter = new DiscogsAdapter({
        userToken: process.env.DISCOGS_USER_TOKEN || 'test-token',
      })
      
      const listings = await adapter.search({
        query: 'The Beatles Abbey Road',
        limit: 5,
      })
      
      expect(listings.length).toBeGreaterThan(0)
      expect(listings[0].platform).toBe('discogs')
      expect(listings[0]).toHaveProperty('title')
      expect(listings[0]).toHaveProperty('price')
    })
  })
  
  describe('Staging Pipeline', () => {
    it('should normalize and validate listings', async () => {
      if (!TEST_DB_URL) {
        console.warn('Skipping pipeline test - no test database')
        return
      }
      
      const mockListing = {
        platform: 'ebay',
        externalId: 'test-123',
        url: 'https://ebay.com/item/test-123',
        title: 'The Beatles - Abbey Road',
        price: 25.99,
        currency: 'USD',
        condition: 'Very Good',
        format: 'LP',
        artist: 'The Beatles',
        album: 'Abbey Road',
        rawData: {},
      }
      
      const result = await pipeline.processRawListing(mockListing as any)
      
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('rawListingId')
      
      if (result.success) {
        expect(result.normalizedListingId).toBeDefined()
        expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      }
    })
    
    it('should reject invalid listings', async () => {
      if (!TEST_DB_URL) {
        console.warn('Skipping pipeline test - no test database')
        return
      }
      
      const invalidListing = {
        platform: 'ebay',
        externalId: '',  // Missing external ID
        url: '',  // Missing URL
        title: '',  // Missing title
        price: -10,  // Invalid price
        currency: 'USD',
        rawData: {},
      }
      
      const result = await pipeline.processRawListing(invalidListing as any)
      
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })
  })
})

// Example test runner (use Jest, Mocha, or similar in production)
if (require.main === module) {
  console.log('Run tests with: npm test or jest')
}

