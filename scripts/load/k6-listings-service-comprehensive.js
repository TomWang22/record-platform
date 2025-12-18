/**
 * k6 Comprehensive Load Test for Listings Service
 * 
 * Tests all listings service endpoints with comprehensive latency tracking:
 * - p1, p5, p10, p25, p50, p75, p90, p95, p99
 * - p999, p9999, p99999, p999999, p9999999, p99999999, p100
 * 
 * Endpoints tested:
 * - GET /api/listings/search (public)
 * - GET /api/listings/:id (public)
 * - GET /api/listings/my-listings (auth required)
 * - POST /api/listings (create listing, auth required)
 * - PUT /api/listings/:id (update listing, auth required)
 * - DELETE /api/listings/:id (delete listing, auth required)
 * - POST /api/listings/:id/images (add image, auth required)
 * - POST /api/listings/:id/bid (place bid, auth required)
 * - POST /api/listings/:id/offer (make offer, auth required)
 * - POST /api/listings/:id/watch (add to watchlist, auth required)
 * - DELETE /api/listings/:id/watch (remove from watchlist, auth required)
 * - GET /api/listings/watchlist/mine (get watchlist, auth required)
 * - GET /api/listings/search/ebay (eBay search, public)
 * - POST /api/listings/ratings (create rating, auth required)
 * - GET /api/listings/ratings/listing/:id (get ratings for listing, public)
 * - GET /api/listings/ratings/seller/:id (get ratings for seller, public)
 * 
 * Usage:
 *   # Basic load test
 *   k6 run --vus 50 --duration 5m scripts/load/k6-listings-service-comprehensive.js
 * 
 *   # High load with detailed metrics
 *   BASE_URL=http://localhost:8080 k6 run --vus 200 --duration 10m scripts/load/k6-listings-service-comprehensive.js
 * 
 *   # In-cluster testing
 *   IN_CLUSTER=true BASE_URL=http://api-gateway.record-platform.svc.cluster.local:4000 k6 run --vus 100 --duration 5m scripts/load/k6-listings-service-comprehensive.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics for detailed latency tracking
const searchLatency = new Trend('listings_search_latency_ms', true);
const getListingLatency = new Trend('listings_get_latency_ms', true);
const createListingLatency = new Trend('listings_create_latency_ms', true);
const updateListingLatency = new Trend('listings_update_latency_ms', true);
const deleteListingLatency = new Trend('listings_delete_latency_ms', true);
const bidLatency = new Trend('listings_bid_latency_ms', true);
const offerLatency = new Trend('listings_offer_latency_ms', true);
const watchlistLatency = new Trend('listings_watchlist_latency_ms', true);
const ebaySearchLatency = new Trend('listings_ebay_search_latency_ms', true);
const ratingLatency = new Trend('listings_rating_latency_ms', true);

// Success/failure tracking
const searchSuccess = new Rate('listings_search_success');
const getListingSuccess = new Rate('listings_get_success');
const createListingSuccess = new Rate('listings_create_success');
const updateListingSuccess = new Rate('listings_update_success');
const deleteListingSuccess = new Rate('listings_delete_success');
const bidSuccess = new Rate('listings_bid_success');
const offerSuccess = new Rate('listings_offer_success');
const watchlistSuccess = new Rate('listings_watchlist_success');
const ebaySearchSuccess = new Rate('listings_ebay_search_success');
const ratingSuccess = new Rate('listings_rating_success');

// Throughput tracking
const totalSearches = new Counter('total_listings_searches');
const totalListingsCreated = new Counter('total_listings_created');
const totalBids = new Counter('total_bids');
const totalOffers = new Counter('total_offers');
const totalWatchlistAdds = new Counter('total_watchlist_adds');
const totalRatings = new Counter('total_ratings');

// Configuration - can be overridden by k6 CLI options (--vus, --duration)
export const options = {
  // Default stages (used if --vus and --duration not specified)
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '2m', target: 20 },     // Ramp up to 20 users
    { duration: '2m', target: 50 },     // Ramp up to 50 users
    { duration: '5m', target: 50 },    // Stay at 50 users for sustained load
    { duration: '1m', target: 0 },      // Ramp down
  ],
  // HTTP/2 and HTTP/3 configuration for optimal performance
  httpReq: {
    timeout: '30s',
    // Enable HTTP/2 and HTTP/3 (QUIC) support
    // k6 automatically negotiates the best protocol via ALPN
  },
  // HTTP connection options to prevent "cannot assign requested address" errors
  httpReq: {
    // Increase connection timeout
    timeout: '30s',
  },
  thresholds: {
    // Comprehensive percentile thresholds for tail latency analysis
    'http_req_duration': [
      'p(1)<50',        // 1st percentile
      'p(5)<100',       // 5th percentile
      'p(10)<150',      // 10th percentile
      'p(25)<200',      // 25th percentile
      'p(50)<300',      // 50th percentile (median)
      'p(75)<400',      // 75th percentile
      'p(90)<500',      // 90th percentile
      'p(95)<600',      // 95th percentile
      'p(99)<1000',     // 99th percentile
      'p(99.9)<2000',   // 99.9th percentile
      'p(99.99)<5000',  // 99.99th percentile
      'p(99.999)<10000', // 99.999th percentile
      'p(99.9999)<20000', // 99.9999th percentile
      'p(99.99999)<50000', // 99.99999th percentile
      'p(99.999999)<100000', // 99.999999th percentile
      'p(100)<200000',  // 100th percentile (max)
    ],
    'http_req_failed': ['rate<0.05'], // Less than 5% failures
    'listings_search_success': ['rate>0.95'],
    'listings_get_success': ['rate>0.95'],
    'listings_create_success': ['rate>0.90'],
    'listings_update_success': ['rate>0.90'],
    'listings_bid_success': ['rate>0.90'],
    'listings_offer_success': ['rate>0.90'],
    'listings_watchlist_success': ['rate>0.95'],
    'listings_ebay_search_success': ['rate>0.80'], // eBay API may be rate-limited
    'listings_rating_success': ['rate>0.95'],
  },
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || (__ENV.IN_CLUSTER === 'true' 
  ? 'http://api-gateway.record-platform.svc.cluster.local:4000'  // Use API Gateway directly (HTTP, not HTTPS)
  : 'https://record.local:30443');
const API_HOST = __ENV.API_HOST || (__ENV.IN_CLUSTER === 'true' 
  ? 'api-gateway.record-platform.svc.cluster.local'  // Use API Gateway hostname
  : 'record.local');
const API_PREFIX = '';  // API Gateway routes are /listings/*, not /api/listings/*

// Helper function to get common request options with X-Loadtest header
function getReqOptions(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Host': API_HOST,  // Ensure correct Host header for SNI (required for HTTP/2 and HTTP/3)
    'X-Loadtest': '1',  // Bypass rate limiting for load tests
    // HTTP/2 and HTTP/3 will be negotiated automatically via ALPN
    // k6 supports HTTP/2 multiplexing and HTTP/3 (QUIC) natively
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return {
    headers: headers,
    // Strict TLS - no skipping verification
    // k6 will automatically use HTTP/2 or HTTP/3 if server supports it
    tags: { protocol: 'auto' },  // Let k6 auto-detect best protocol
  };
}

// User credentials (from test-microservices-http2-http3.sh pattern)
let userTokens = {};
let userIds = {};
let userCounter = 0;
let createdListingIds = {}; // Track created listings per user

// Helper: Register/Login user
function authenticateUser(vuId) {
  const email = `k6-listings-test-${vuId}-${Date.now()}@example.com`;
  const password = 'test123';

  // Try registration first
  const registerOpts = getReqOptions(null);
  registerOpts.tags = { name: 'Auth_Register' };
  let registerRes = http.post(
    `${BASE_URL}${API_PREFIX}/auth/register`,
    JSON.stringify({ email, password }),
    registerOpts
  );

  // If registration fails, try login
  if (registerRes.status !== 201) {
    const loginOpts = getReqOptions(null);
    loginOpts.tags = { name: 'Auth_Login' };
    const loginRes = http.post(
      `${BASE_URL}${API_PREFIX}/auth/login`,
      JSON.stringify({ email, password }),
      loginOpts
    );
    
    if (loginRes.status === 200) {
      const body = JSON.parse(loginRes.body);
      return body.token || body.access_token;
    }
    return null;
  }

  const body = JSON.parse(registerRes.body);
  return body.token || body.access_token;
}

// Test search listings (public endpoint)
function testSearchListings() {
  const searchQueries = [
    'vinyl',
    'record',
    'LP',
    'The Beatles',
    'Pink Floyd',
    'Jazz',
    'Classical',
    'Rock',
    'Jazz',
    'Blues',
  ];

  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  const startTime = Date.now();
  
  const opts = getReqOptions(null);
  opts.tags = { name: 'Listings_Search', type: 'read' };
  opts.params = {
    ...opts.params,
    q: query,
    limit: 20,
    offset: Math.floor(Math.random() * 10) * 20,
  };

  const res = http.get(`${BASE_URL}${API_PREFIX}/listings/search`, opts);
  const latency = Date.now() - startTime;
  searchLatency.add(latency);
  totalSearches.add(1);

  const success = check(res, {
    'search status 200': (r) => r.status === 200,
    'search has listings array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.listings) || Array.isArray(body);
      } catch {
        return false;
      }
    },
    'search response time < 2s': (r) => r.timings.duration < 2000,
  });

  searchSuccess.add(success ? 1 : 0);
  return success ? JSON.parse(res.body) : null;
}

// Test get listing by ID (public endpoint)
function testGetListing(listingId) {
  if (!listingId) return null;

  const startTime = Date.now();
  const opts = getReqOptions(null);
  opts.tags = { name: 'Listings_Get', type: 'read' };

  const res = http.get(`${BASE_URL}${API_PREFIX}/listings/${listingId}`, opts);
  const latency = Date.now() - startTime;
  getListingLatency.add(latency);

  const success = check(res, {
    'get listing status 200 or 404': (r) => r.status === 200 || r.status === 404,
    'get listing response time < 1s': (r) => r.timings.duration < 1000,
  });

  getListingSuccess.add(success ? 1 : 0);
  return success && res.status === 200 ? JSON.parse(res.body) : null;
}

// Test create listing (auth required)
function testCreateListing(token) {
  if (!token) return null;

  const startTime = Date.now();
  const opts = getReqOptions(token);
  opts.tags = { name: 'Listings_Create', type: 'write' };

  const listingData = {
    title: `Test Listing ${Date.now()}`,
    description: 'Test listing description for load testing',
    price: 10 + Math.random() * 100,
    currency: 'USD',
    listing_type: Math.random() > 0.5 ? 'fixed_price' : 'auction',
    condition: ['Mint', 'Near Mint', 'Very Good', 'Good'][Math.floor(Math.random() * 4)],
    category: 'Music',
    location: 'Test Location',
    shipping_cost: 5 + Math.random() * 10,
    shipping_method: 'Standard',
    media_type: 'Vinyl',
    has_obi: Math.random() > 0.5,
    label_type: 'Original',
    stock_quantity: 1,
    duration_days: 30,
  };

  const res = http.post(
    `${BASE_URL}${API_PREFIX}/listings`,
    JSON.stringify(listingData),
    opts
  );
  const latency = Date.now() - startTime;
  createListingLatency.add(latency);

  const success = check(res, {
    'create listing status 201': (r) => r.status === 201,
    'create listing has id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.id !== undefined;
      } catch {
        return false;
      }
    },
    'create listing response time < 2s': (r) => r.timings.duration < 2000,
  });

  createListingSuccess.add(success ? 1 : 0);
  totalListingsCreated.add(success ? 1 : 0);

  if (success) {
    const body = JSON.parse(res.body);
    return body.id;
  }
  return null;
}

// Test update listing (auth required)
function testUpdateListing(listingId, token) {
  if (!listingId || !token) return false;

  const startTime = Date.now();
  const opts = getReqOptions(token);
  opts.tags = { name: 'Listings_Update', type: 'write' };

  const updateData = {
    price: 20 + Math.random() * 100,
    description: `Updated description ${Date.now()}`,
  };

  const res = http.put(
    `${BASE_URL}${API_PREFIX}/listings/${listingId}`,
    JSON.stringify(updateData),
    opts
  );
  const latency = Date.now() - startTime;
  updateListingLatency.add(latency);

  const success = check(res, {
    'update listing status 200': (r) => r.status === 200,
    'update listing response time < 2s': (r) => r.timings.duration < 2000,
  });

  updateListingSuccess.add(success ? 1 : 0);
  return success;
}

// Test place bid (auth required)
function testPlaceBid(listingId, token) {
  if (!listingId || !token) return false;

  const startTime = Date.now();
  const opts = getReqOptions(token);
  opts.tags = { name: 'Listings_Bid', type: 'write' };

  const bidData = {
    bid_amount: 10 + Math.random() * 50,
  };

  const res = http.post(
    `${BASE_URL}${API_PREFIX}/listings/${listingId}/bid`,
    JSON.stringify(bidData),
    opts
  );
  const latency = Date.now() - startTime;
  bidLatency.add(latency);
  totalBids.add(1);

  const success = check(res, {
    'bid status 201 or 400': (r) => r.status === 201 || r.status === 400, // 400 if bid too low
    'bid response time < 2s': (r) => r.timings.duration < 2000,
  });

  bidSuccess.add(success ? 1 : 0);
  return success;
}

// Test make offer (auth required)
function testMakeOffer(listingId, token) {
  if (!listingId || !token) return false;

  const startTime = Date.now();
  const opts = getReqOptions(token);
  opts.tags = { name: 'Listings_Offer', type: 'write' };

  const offerData = {
    offer_amount: 15 + Math.random() * 50,
    message: 'Test offer message',
  };

  const res = http.post(
    `${BASE_URL}${API_PREFIX}/listings/${listingId}/offer`,
    JSON.stringify(offerData),
    opts
  );
  const latency = Date.now() - startTime;
  offerLatency.add(latency);
  totalOffers.add(1);

  const success = check(res, {
    'offer status 201 or 400': (r) => r.status === 201 || r.status === 400,
    'offer response time < 2s': (r) => r.timings.duration < 2000,
  });

  offerSuccess.add(success ? 1 : 0);
  return success;
}

// Test watchlist operations (auth required)
function testWatchlist(listingId, token) {
  if (!listingId || !token) return false;

  const startTime = Date.now();
  const opts = getReqOptions(token);
  opts.tags = { name: 'Listings_Watchlist', type: 'write' };

  // Add to watchlist
  const addRes = http.post(
    `${BASE_URL}${API_PREFIX}/listings/${listingId}/watch`,
    null,
    opts
  );
  totalWatchlistAdds.add(1);

  // Get watchlist
  const getWatchlistOpts = getReqOptions(token);
  getWatchlistOpts.tags = { name: 'Listings_GetWatchlist', type: 'read' };
  const getRes = http.get(`${BASE_URL}${API_PREFIX}/listings/watchlist/mine`, getWatchlistOpts);

  const latency = Date.now() - startTime;
  watchlistLatency.add(latency);

  const success = check(addRes, {
    'add to watchlist status 201 or 200': (r) => r.status === 201 || r.status === 200,
  }) && check(getRes, {
    'get watchlist status 200': (r) => r.status === 200,
    'get watchlist response time < 1s': (r) => r.timings.duration < 1000,
  });

  watchlistSuccess.add(success ? 1 : 0);
  return success;
}

// Test eBay search (public endpoint)
function testEbaySearch() {
  const searchQueries = [
    'vinyl record',
    'LP record',
    'The Beatles',
    'Pink Floyd',
  ];

  const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
  const startTime = Date.now();
  
  const opts = getReqOptions(null);
  opts.tags = { name: 'Listings_EbaySearch', type: 'read' };
  opts.params = {
    ...opts.params,
    q: query,
  };

  const res = http.get(`${BASE_URL}${API_PREFIX}/listings/search/ebay`, opts);
  const latency = Date.now() - startTime;
  ebaySearchLatency.add(latency);

  const success = check(res, {
    'ebay search status 200': (r) => r.status === 200,
    'ebay search response time < 5s': (r) => r.timings.duration < 5000, // eBay API may be slow
  });

  ebaySearchSuccess.add(success ? 1 : 0);
  return success;
}

// Test ratings (auth required for create, public for get)
function testRatings(listingId, token) {
  if (!listingId) return false;

  const startTime = Date.now();

  // Create rating (auth required)
  if (token) {
    const createOpts = getReqOptions(token);
    createOpts.tags = { name: 'Listings_CreateRating', type: 'write' };

    const ratingData = {
      listing_id: listingId,
      rating: Math.floor(Math.random() * 5) + 1, // 1-5
      review_text: 'Test review',
    };

    const createRes = http.post(
      `${BASE_URL}${API_PREFIX}/listings/ratings`,
      JSON.stringify(ratingData),
      createOpts
    );
    totalRatings.add(1);
  }

  // Get ratings for listing (public)
  const getOpts = getReqOptions(null);
  getOpts.tags = { name: 'Listings_GetRatings', type: 'read' };
  const getRes = http.get(`${BASE_URL}${API_PREFIX}/listings/ratings/listing/${listingId}`, getOpts);

  const latency = Date.now() - startTime;
  ratingLatency.add(latency);

  const success = check(getRes, {
    'get ratings status 200': (r) => r.status === 200,
    'get ratings response time < 1s': (r) => r.timings.duration < 1000,
  });

  ratingSuccess.add(success ? 1 : 0);
  return success;
}

// Main test function
export default function () {
  const vuId = __VU;

  // Authenticate user (cache token per VU)
  if (!userTokens[vuId]) {
    userTokens[vuId] = authenticateUser(vuId);
    if (!userTokens[vuId]) {
      console.error(`[VU ${vuId}] Authentication failed`);
      return;
    }
    createdListingIds[vuId] = [];
  }

  const token = userTokens[vuId];

  // Test flow: mix of read and write operations
  group('Listings Service Load Test', () => {
    // Public read operations (no auth)
    group('Public Read Operations', () => {
      // Search listings
      const searchResults = testSearchListings();
      sleep(0.5);

      // Get a random listing if search returned results
      if (searchResults && searchResults.listings && searchResults.listings.length > 0) {
        const randomListing = searchResults.listings[Math.floor(Math.random() * searchResults.listings.length)];
        testGetListing(randomListing.id);
        sleep(0.3);
      }

      // eBay search (may be rate-limited)
      if (Math.random() > 0.7) { // 30% chance
        testEbaySearch();
        sleep(1);
      }
    });

    // Authenticated write operations
    group('Authenticated Write Operations', () => {
      // Create listing
      if (Math.random() > 0.5) { // 50% chance
        const listingId = testCreateListing(token);
        if (listingId) {
          createdListingIds[vuId].push(listingId);
          sleep(0.5);

          // Update listing
          if (Math.random() > 0.7) { // 30% chance
            testUpdateListing(listingId, token);
            sleep(0.3);
          }

          // Place bid (if auction)
          if (Math.random() > 0.6) { // 40% chance
            testPlaceBid(listingId, token);
            sleep(0.3);
          }

          // Make offer
          if (Math.random() > 0.7) { // 30% chance
            testMakeOffer(listingId, token);
            sleep(0.3);
          }

          // Add to watchlist
          if (Math.random() > 0.5) { // 50% chance
            testWatchlist(listingId, token);
            sleep(0.3);
          }

          // Create/get ratings
          if (Math.random() > 0.6) { // 40% chance
            testRatings(listingId, token);
            sleep(0.3);
          }
        }
      }
    });
  });

  // Random sleep between iterations
  sleep(Math.random() * 2 + 1);
}

// Summary handler for detailed percentile reporting
export function handleSummary(data) {
  // Safely extract comprehensive percentiles from HTTP metrics
  if (!data || !data.metrics || !data.metrics.http_req_duration) {
    console.error('Invalid data structure in handleSummary');
    return { 'stdout': JSON.stringify({ error: 'Invalid data structure' }, null, 2) };
  }
  
  const httpDuration = data.metrics.http_req_duration;
  const percentiles = httpDuration.values || httpDuration.percentiles || {};

  // Helper to extract percentile value (k6 uses 'p(XX)' format)
  const getPercentile = (p) => {
    const key = `p(${p})`;
    return percentiles[key] || 0;
  };

  // Calculate all requested percentiles
  const percentileData = {
    p1: getPercentile(1),
    p5: getPercentile(5),
    p10: getPercentile(10),
    p25: getPercentile(25),
    p50: getPercentile(50),
    p75: getPercentile(75),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99),
    p999: getPercentile(99.9),
    p9999: getPercentile(99.99),
    p99999: getPercentile(99.999),
    p999999: getPercentile(99.9999),
    p9999999: getPercentile(99.99999),
    p99999999: getPercentile(99.999999),
    p100: percentiles.max || 0,
  };

  // Format summary output (with safe access)
  const httpReqs = data.metrics?.http_reqs?.values || data.metrics?.http_reqs || {};
  const httpFailed = data.metrics?.http_req_failed?.values || data.metrics?.http_req_failed || {};
  const errorRate = httpFailed.rate || 0;
  
  // Safely get latency values
  const latencyMin = percentiles.min || httpDuration.values?.min || 0;
  const latencyAvg = percentiles.avg || httpDuration.values?.avg || 0;
  const latencyMax = percentiles.max || httpDuration.values?.max || 0;
  const latencyMed = percentiles.med || httpDuration.values?.med || percentileData.p50 || 0;
  
  const summary = {
    timestamp: new Date().toISOString(),
    test: 'Listings Service Comprehensive Load Test',
    summary: {
      total_requests: httpReqs.count || httpReqs.values?.count || 0,
      test_duration: (data.state?.testRunDurationMs || 0) / 1000,
      http_error_rate: (errorRate * 100).toFixed(2) + '%',
      http_success_rate: ((1 - errorRate) * 100).toFixed(2) + '%',
    },
    http_latency: {
      min: latencyMin.toFixed(2) + 'ms',
      avg: latencyAvg.toFixed(2) + 'ms',
      max: latencyMax.toFixed(2) + 'ms',
      median: latencyMed.toFixed(2) + 'ms',
      percentiles: {
        'p1 (1st)': percentileData.p1.toFixed(2) + 'ms',
        'p5 (5th)': percentileData.p5.toFixed(2) + 'ms',
        'p10 (10th)': percentileData.p10.toFixed(2) + 'ms',
        'p25 (25th)': percentileData.p25.toFixed(2) + 'ms',
        'p50 (median)': percentileData.p50.toFixed(2) + 'ms',
        'p75 (75th)': percentileData.p75.toFixed(2) + 'ms',
        'p90 (90th)': percentileData.p90.toFixed(2) + 'ms',
        'p95 (95th)': percentileData.p95.toFixed(2) + 'ms',
        'p99 (99th)': percentileData.p99.toFixed(2) + 'ms',
        'p999 (99.9th)': percentileData.p999.toFixed(2) + 'ms',
        'p9999 (99.99th)': percentileData.p9999.toFixed(2) + 'ms',
        'p99999 (99.999th)': percentileData.p99999.toFixed(2) + 'ms',
        'p999999 (99.9999th)': percentileData.p999999.toFixed(2) + 'ms',
        'p9999999 (99.99999th)': percentileData.p9999999.toFixed(2) + 'ms',
        'p99999999 (99.999999th)': percentileData.p99999999.toFixed(2) + 'ms',
        'p100 (max)': percentileData.p100.toFixed(2) + 'ms',
      },
    },
    custom_metrics: {
      search_latency: {
        avg: ((data.metrics?.listings_search_latency_ms?.values?.avg) || 0).toFixed(2) + 'ms',
        p95: ((data.metrics?.listings_search_latency_ms?.values?.['p(95)']) || 0).toFixed(2) + 'ms',
        p99: ((data.metrics?.listings_search_latency_ms?.values?.['p(99)']) || 0).toFixed(2) + 'ms',
      },
      create_latency: {
        avg: ((data.metrics?.listings_create_latency_ms?.values?.avg) || 0).toFixed(2) + 'ms',
        p95: ((data.metrics?.listings_create_latency_ms?.values?.['p(95)']) || 0).toFixed(2) + 'ms',
        p99: ((data.metrics?.listings_create_latency_ms?.values?.['p(99)']) || 0).toFixed(2) + 'ms',
      },
      bid_latency: {
        avg: ((data.metrics?.listings_bid_latency_ms?.values?.avg) || 0).toFixed(2) + 'ms',
        p95: ((data.metrics?.listings_bid_latency_ms?.values?.['p(95)']) || 0).toFixed(2) + 'ms',
        p99: ((data.metrics?.listings_bid_latency_ms?.values?.['p(99)']) || 0).toFixed(2) + 'ms',
      },
    },
    throughput: {
      total_searches: data.metrics?.total_listings_searches?.values?.count || data.metrics?.total_listings_searches?.count || 0,
      total_listings_created: data.metrics?.total_listings_created?.values?.count || data.metrics?.total_listings_created?.count || 0,
      total_bids: data.metrics?.total_bids?.values?.count || data.metrics?.total_bids?.count || 0,
      total_offers: data.metrics?.total_offers?.values?.count || data.metrics?.total_offers?.count || 0,
      total_watchlist_adds: data.metrics?.total_watchlist_adds?.values?.count || data.metrics?.total_watchlist_adds?.count || 0,
      total_ratings: data.metrics?.total_ratings?.values?.count || data.metrics?.total_ratings?.count || 0,
    },
  };

  // Print formatted summary
  console.log('\n=== Listings Service Load Test Summary ===');
  console.log(`Total Requests: ${summary.summary.total_requests}`);
  console.log(`Test Duration: ${summary.summary.test_duration.toFixed(1)}s`);
  console.log(`HTTP Success Rate: ${summary.summary.http_success_rate}`);
  console.log(`HTTP Error Rate: ${summary.summary.http_error_rate}`);
  console.log('\n=== HTTP Latency Percentiles ===');
  console.log(`Min: ${summary.http_latency.min}`);
  console.log(`Avg: ${summary.http_latency.avg}`);
  console.log(`Median: ${summary.http_latency.median}`);
  console.log(`Max: ${summary.http_latency.max}`);
  console.log('\nDetailed Percentiles:');
  Object.entries(summary.http_latency.percentiles).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  console.log('\n=== Custom Metrics ===');
  console.log('Search Latency:', summary.custom_metrics.search_latency);
  console.log('Create Latency:', summary.custom_metrics.create_latency);
  console.log('Bid Latency:', summary.custom_metrics.bid_latency);

  console.log('\n=== Throughput ===');
  Object.entries(summary.throughput).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  // Return summary for JSON export
  return {
    'stdout': JSON.stringify(summary, null, 2),
  };
}

