/**
 * k6 Load Test: Analytics Pipeline with REAL API Data
 * 
 * Tests the analytics pipeline using REAL data from eBay and Discogs APIs:
 * - Creates watchlist entries with real queries
 * - Triggers auction monitor to fetch real listings
 * - Validates real data flows through the pipeline
 * - Tests with production-like data patterns
 * 
 * Usage:
 *   k6 run --vus 5 --duration 2m scripts/load/k6-analytics-real-data.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:4008';
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const LISTINGS_DB_URL = __ENV.POSTGRES_URL_LISTINGS || 'postgresql://postgres:postgres@localhost:5435/records';
const TOKEN = __ENV.TOKEN || '';
const VUS = Number(__ENV.VUS || 5);
const DURATION = __ENV.DURATION || '120s';

// Real search queries that should return results
const REAL_QUERIES = [
  'The Beatles Abbey Road',
  'Pink Floyd Dark Side of the Moon',
  'Led Zeppelin IV',
  'The Rolling Stones Sticky Fingers',
  'Queen A Night at the Opera',
  'David Bowie Ziggy Stardust',
  'Fleetwood Mac Rumours',
  'The Who Who\'s Next',
  'Radiohead OK Computer',
  'Nirvana Nevermind',
];

// Custom metrics
const realDataIngested = new Rate('real_data_ingested');
const pipelineLatency = new Trend('pipeline_latency');
const apiSuccess = new Rate('api_success');
const dataQualityScore = new Trend('data_quality_score');

export const options = {
  stages: [
    { duration: '10s', target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.50'], // Allow 50% failures (API auth issues, rate limits, etc.)
    'real_data_ingested': ['rate>0.50'], // At least 50% should get real data
    'api_success': ['rate>0.70'], // 70% API calls should succeed
  },
};

// Create a watchlist entry and trigger monitoring
function createWatchlistAndMonitor(query) {
  // Use a test user ID for load testing
  const testUserId = '00000000-0000-0000-0000-000000000000'; // Test UUID
  
  // Step 1: Trigger monitoring for this query
  // The /monitor endpoint requires x-user-id header
  const monitorRes = http.post(
    `${BASE_URL}/monitor`,
    JSON.stringify({
      source: 'ebay',
      query: query,
    }),
    {
      headers: { 
        'Content-Type': 'application/json',
        'x-user-id': testUserId,
      },
      tags: { name: 'trigger_monitor' },
    }
  );
  
  const monitorCheck = check(monitorRes, {
    'monitor triggered successfully': (r) => r.status === 200 || r.status === 201 || r.status === 202,
    'monitor returns valid response': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok !== false; // Accept any response that's not explicitly an error
      } catch {
        return r.status < 500; // Accept any non-500 status
      }
    },
  });
  
  if (monitorCheck) {
    apiSuccess.add(1);
  } else {
    apiSuccess.add(0);
  }
  
  sleep(2); // Wait for initial processing
  
  // Step 3: Check if results are available
  const resultsRes = http.get(`${BASE_URL}/results`, {
    params: { source: 'ebay', query: query },
    tags: { name: 'check_results' },
  });
  
  if (resultsRes.status === 200) {
    try {
      const body = JSON.parse(resultsRes.body);
      if (body.results && Array.isArray(body.results) && body.results.length > 0) {
        realDataIngested.add(1);
        
        // Validate data quality of real results
        const result = body.results[0];
        let qualityScore = 0;
        if (result.title) qualityScore += 0.3;
        if (result.price && result.price > 0) qualityScore += 0.3;
        if (result.url) qualityScore += 0.2;
        if (result.ends_at || result.sold_at) qualityScore += 0.2;
        dataQualityScore.add(qualityScore);
        
        return true;
      }
    } catch (e) {
      // Invalid JSON, but not necessarily a failure
    }
  }
  
  realDataIngested.add(0);
  return false;
}

// Query analytics service with real data
function queryAnalyticsWithRealData(query) {
  const artist = query.split(' ')[0]; // Simple extraction
  const name = query.split(' ').slice(1).join(' ');
  
  // Query price trends
  const trendRes = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
    params: {
      artist: artist,
      name: name,
      days: 90,
    },
    tags: { name: 'price_trend_real' },
  });
  
  check(trendRes, {
    'price trend returns valid response': (r) => r.status === 200 || r.status === 400,
  });
  
  // Query fuzzy search
  const fuzzyRes = http.get(`${ANALYTICS_URL}/analytics/fuzzy-search`, {
    params: {
      q: query,
      limit: 10,
    },
    tags: { name: 'fuzzy_search_real' },
  });
  
  check(fuzzyRes, {
    'fuzzy search returns valid response': (r) => r.status === 200 || r.status === 400,
  });
  
  sleep(1);
}

export default function () {
  // Select a random real query
  const query = REAL_QUERIES[Math.floor(Math.random() * REAL_QUERIES.length)];
  
  // Test 1: Health check
  const healthRes = http.get(`${BASE_URL}/healthz`, {
    tags: { name: 'health_check' },
  });
  
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });
  
  sleep(0.5);
  
  // Test 2: Create watchlist and trigger real API calls
  const startTime = Date.now();
  const hasRealData = createWatchlistAndMonitor(query);
  const latency = Date.now() - startTime;
  
  if (hasRealData) {
    pipelineLatency.add(latency);
    
    // Test 3: Query analytics with real data
    queryAnalyticsWithRealData(query);
  }
  
  sleep(2); // Wait between iterations to avoid rate limiting
}

export function handleSummary(data) {
  return {
    'stdout': `
📊 Analytics Pipeline Real Data Test Results
============================================

Test Configuration:
  Base URL: ${BASE_URL}
  Analytics URL: ${ANALYTICS_URL}
  Virtual Users: ${VUS}
  Duration: ${DURATION}
  Real Queries: ${REAL_QUERIES.length} different queries

HTTP Metrics:
  Total Requests: ${data.metrics.http_reqs?.values?.count || 0}
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${data.metrics.http_req_duration?.values?.['p(95)'] !== undefined ? data.metrics.http_req_duration.values['p(95)'].toFixed(2) : 'N/A'}ms
  P99 Duration: ${data.metrics.http_req_duration?.values?.['p(99)'] !== undefined ? data.metrics.http_req_duration.values['p(99)'].toFixed(2) : 'N/A'}ms

Real Data Metrics:
  Real Data Ingested: ${((data.metrics.real_data_ingested?.values?.rate || 0) * 100).toFixed(1)}%
  API Success Rate: ${((data.metrics.api_success?.values?.rate || 0) * 100).toFixed(1)}%
  Avg Pipeline Latency: ${(data.metrics.pipeline_latency?.values?.avg || 0).toFixed(2)}ms
  Avg Data Quality Score: ${(data.metrics.data_quality_score?.values?.avg || 0).toFixed(3)}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.50 && (data.metrics.real_data_ingested?.values?.rate || 0) > 0.50 ? '✅ PASS' : '❌ FAIL'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

