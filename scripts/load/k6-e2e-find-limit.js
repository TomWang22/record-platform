/**
 * k6 E2E Test: Find Maximum Capacity Limit
 * 
 * Tests all microservices (excluding webapp frontend) with ramping load to find maximum capacity.
 * Supports both HTTP/2 and HTTP/3 based on HTTP_VERSION environment variable.
 * 
 * Services tested:
 * - Auth Service (register, login, logout) - gatekeeper, needs careful budgeting
 * - Records Service (CRUD operations)
 * - Listings Service (search, create, get)
 * - Messaging Service (forum posts, messages)
 * - Shopping Service (cart, checkout, orders)
 * - Analytics Service (ingestion)
 * - Python AI Service (advice)
 * 
 * Ramp strategy: Gradually increase load to find where services start failing
 * - Starts at 10 VUs
 * - Gradually increases to find the breaking point
 * - Monitors success rates and latency
 * 
 * Usage:
 *   # HTTP/2 limit finding
 *   k6 run scripts/load/k6-e2e-find-limit.js
 * 
 *   # HTTP/3 limit finding
 *   HTTP_VERSION=HTTP/3 k6 run scripts/load/k6-e2e-find-limit.js
 * 
 *   # Custom configuration
 *   BASE_URL=https://record.local:30443 HOST=record.local \
 *   HTTP_VERSION=HTTP/3 \
 *   k6 run scripts/load/k6-e2e-find-limit.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const HOST = __ENV.HOST || 'record.local';
const HTTP_VERSION = __ENV.HTTP_VERSION || 'HTTP/2'; // HTTP/2 or HTTP/3
const DEBUG = __ENV.DEBUG === 'true';

// Custom metrics per service
const authSuccess = new Rate('auth_success_rate');
const recordsSuccess = new Rate('records_success_rate');
const listingsSuccess = new Rate('listings_success_rate');
const socialSuccess = new Rate('social_success_rate');
const shoppingSuccess = new Rate('shopping_success_rate');
const analyticsSuccess = new Rate('analytics_success_rate');
const pythonAISuccess = new Rate('python_ai_success_rate');

// Latency trends per service
const authLatency = new Trend('auth_latency_ms', true);
const recordsLatency = new Trend('records_latency_ms', true);
const listingsLatency = new Trend('listings_latency_ms', true);
const socialLatency = new Trend('social_latency_ms', true);
const shoppingLatency = new Trend('shopping_latency_ms', true);
const analyticsLatency = new Trend('analytics_latency_ms', true);
const pythonAILatency = new Trend('python_ai_latency_ms', true);

// Error counters
const authErrors = new Counter('auth_errors');
const recordsErrors = new Counter('records_errors');
const listingsErrors = new Counter('listings_errors');
const socialErrors = new Counter('social_errors');
const shoppingErrors = new Counter('shopping_errors');
const analyticsErrors = new Counter('analytics_errors');
const pythonAIErrors = new Counter('python_ai_errors');

// Overall system health
const overallSuccessRate = new Gauge('overall_success_rate');
const currentVUs = new Gauge('current_vus');

// Auth service budgeting: Since auth is the gatekeeper, we need to:
// 1. Limit concurrent auth requests (bcrypt is CPU-intensive)
// 2. Add delays between auth operations to prevent queue saturation
// 3. Reuse tokens to minimize auth load
const AUTH_BUDGET_DELAY = 0.1; // 100ms delay between auth operations

// Ramp up strategy to find limits (FASTER VERSION):
// - Start low (10 VUs) to establish baseline
// - Quickly ramp to find where services start struggling
// - Monitor success rates - when they drop below 95%, we've found a limit
export const options = {
  stages: [
    { duration: '15s', target: 10 },   // Warmup - establish baseline (reduced from 30s)
    { duration: '30s', target: 50 },   // Quick ramp to moderate load (combined 25→50)
    { duration: '30s', target: 100 },  // Higher load (reduced from 2m)
    { duration: '30s', target: 200 },  // High load (reduced from 2m)
    { duration: '30s', target: 300 },  // Very high load (reduced from 2m)
    { duration: '1m', target: 500 },   // Extreme load - hold for 1min to find limits (reduced from 2m)
    { duration: '15s', target: 0 },    // Quick ramp down (reduced from 1m)
  ],
  thresholds: {
    // Overall thresholds - relaxed to allow finding limits
    'http_req_failed': ['rate<0.10'], // Allow up to 10% failure when finding limits
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'], // Latency will increase under load
    
    // Per-service thresholds - monitor for degradation
    'auth_success_rate': ['rate>0.90'], // Auth can degrade first (bcrypt bottleneck)
    'records_success_rate': ['rate>0.90'],
    'listings_success_rate': ['rate>0.90'],
    'social_success_rate': ['rate>0.85'], // Can be more lenient (Kafka dependency)
    'shopping_success_rate': ['rate>0.90'],
    'analytics_success_rate': ['rate>0.85'], // Can be more lenient (Kafka dependency)
    'python_ai_success_rate': ['rate>0.85'], // Can be more lenient (AI processing)
  },
};

let token = '';
let userId = '';
let listingId = '';
let recordId = '';

// Helper: Extract user ID from JWT
function extractUserId(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || payload.user_id || null;
  } catch (e) {
    return null;
  }
}

// Helper: Make request with timing and proper HTTP version
function makeRequest(method, url, body, headers, serviceName) {
  const startTime = Date.now();
  
  // Determine HTTP version (let k6 negotiate naturally, don't force)
  const httpVersion = HTTP_VERSION === 'HTTP/3' ? 'HTTP/3' : 'HTTP/2';
  
  const params = {
    headers: {
      'Host': HOST,
      'Content-Type': 'application/json',
      'X-Loadtest': '1', // Bypass rate limiting
      ...headers,
    },
    timeout: '30s',
    httpVersion: httpVersion, // Let k6 negotiate - no force flags
    tags: { name: `${serviceName}_${method.toLowerCase()}`, protocol: httpVersion },
  };
  
  let res;
  let error = null;
  
  try {
    switch (method.toUpperCase()) {
      case 'GET':
        res = http.get(url, params);
        break;
      case 'POST':
        res = http.post(url, JSON.stringify(body), params);
        break;
      case 'PUT':
        res = http.put(url, JSON.stringify(body), params);
        break;
      case 'DELETE':
        res = http.del(url, null, params);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  } catch (e) {
    error = e;
    res = {
      status: 0,
      status_text: 'Request Failed',
      url: url,
      body: '',
      headers: {},
      error: e.message || 'Unknown error',
    };
  }
  
  const latency = Date.now() - startTime;
  const success = res.status >= 200 && res.status < 300;
  
  if (DEBUG && !success) {
    console.error(`[${serviceName}] ${method} ${url} failed:`, {
      status: res.status,
      error: error?.message || res.error,
      latency,
    });
  }
  
  return { res, latency, success, error };
}

export function setup() {
  // Register a test user
  const email = `k6-limit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  const password = 'TestPassword123!';
  
  sleep(AUTH_BUDGET_DELAY);
  
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password }),
    {
      headers: {
        'Host': HOST,
        'Content-Type': 'application/json',
        'X-Loadtest': '1',
      },
      timeout: '30s',
      httpVersion: HTTP_VERSION === 'HTTP/3' ? 'HTTP/3' : 'HTTP/2',
      tags: { name: 'setup_register' },
    }
  );
  
  if (registerRes.status === 201 || registerRes.status === 409) {
    sleep(AUTH_BUDGET_DELAY);
    
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password }),
      {
        headers: {
          'Host': HOST,
          'Content-Type': 'application/json',
          'X-Loadtest': '1',
        },
        timeout: '30s',
        httpVersion: HTTP_VERSION === 'HTTP/3' ? 'HTTP/3' : 'HTTP/2',
        tags: { name: 'setup_login' },
      }
    );
    
    if (loginRes.status === 200) {
      try {
        const body = JSON.parse(loginRes.body);
        token = body.token || body.accessToken || '';
        userId = extractUserId(token);
      } catch (e) {
        console.error('[SETUP] Failed to parse login response:', e.message);
      }
    }
  }
  
  return { token, userId, email, password };
}

export default function (data) {
  if (!data.token) {
    sleep(1);
    return;
  }
  
  token = data.token;
  userId = data.userId || '';
  
  // Track current VUs
  currentVUs.add(__VU);
  
  // Auth Service - minimal operations (bcrypt bottleneck)
  group('Auth Service', () => {
    // Just validate token (no bcrypt, fast)
    if (Math.random() > 0.9) {
      const { res, latency: authLatencyMs, success: authSuccessVal } = makeRequest(
        'GET',
        `${BASE_URL}/api/auth/whoami`,
        null,
        { 'Authorization': `Bearer ${token}` },
        'auth'
      );
      
      authLatency.add(authLatencyMs);
      authSuccess.add(authSuccessVal);
      if (!authSuccessVal) authErrors.add(1);
    }
  });
  
  // Records Service
  group('Records Service', () => {
    // Get records
    const { res: recordsRes, latency: recordsLatencyMs, success: recordsSuccessVal } = makeRequest(
      'GET',
      `${BASE_URL}/api/records`,
      null,
      { 'Authorization': `Bearer ${token}` },
      'records'
    );
    
    recordsLatency.add(recordsLatencyMs);
    recordsSuccess.add(recordsSuccessVal);
    if (!recordsSuccessVal) recordsErrors.add(1);
    
    // Create record
    if (Math.random() > 0.7 && recordsSuccessVal) {
      const { res: createRes, latency: createLatencyMs, success: createSuccessVal2 } = makeRequest(
        'POST',
        `${BASE_URL}/api/records`,
        {
          artist: `Test Artist ${Date.now()}`,
          title: `Test Title ${Date.now()}`,
          format: 'LP',
        },
        { 'Authorization': `Bearer ${token}` },
        'records'
      );
      
      recordsLatency.add(createLatencyMs);
      recordsSuccess.add(createSuccessVal2);
      if (!createSuccessVal2) recordsErrors.add(1);
      
      if (createSuccessVal2 && createRes.status === 201) {
        const body = JSON.parse(createRes.body);
        recordId = body.id || '';
      }
    }
  });
  
  // Listings Service
  group('Listings Service', () => {
    // Search listings
    const { res: searchRes, latency: searchLatencyMs, success: searchSuccessVal } = makeRequest(
      'GET',
      `${BASE_URL}/api/listings/search?q=test`,
      null,
      {},
      'listings'
    );
    
    listingsLatency.add(searchLatencyMs);
    listingsSuccess.add(searchSuccessVal);
    if (!searchSuccessVal) listingsErrors.add(1);
    
    // Create listing
    if (Math.random() > 0.8 && searchSuccessVal) {
      const { res: createRes, latency: createLatencyMs, success: createSuccessVal } = makeRequest(
        'POST',
        `${BASE_URL}/api/listings`,
        {
          title: `k6 Listing ${Date.now()}`,
          description: 'Test listing from k6',
          price: 29.99,
          format: 'LP',
        },
        { 'Authorization': `Bearer ${token}` },
        'listings'
      );
      
      listingsLatency.add(createLatencyMs);
      listingsSuccess.add(createSuccessVal);
      if (!createSuccessVal) listingsErrors.add(1);
      
      if (createSuccessVal && createRes.status === 201) {
        const body = JSON.parse(createRes.body);
        listingId = body.id || '';
      }
    }
  });
  
  // Messaging Service
  group('Messaging Service', () => {
    // Get forum posts
    if (Math.random() > 0.5) {
      const { res, latency: socialLatencyMs, success: socialSuccessVal } = makeRequest(
        'GET',
        `${BASE_URL}/api/forum/posts`,
        null,
        { 'Authorization': `Bearer ${token}` },
        'social'
      );
      
      socialLatency.add(socialLatencyMs);
      socialSuccess.add(socialSuccessVal);
      if (!socialSuccessVal) socialErrors.add(1);
    }
  });
  
  // Shopping Service
  group('Shopping Service', () => {
    // Get cart
    const { res: cartRes, latency: cartLatencyMs, success: cartSuccessVal } = makeRequest(
      'GET',
      `${BASE_URL}/api/cart`,
      null,
      { 'Authorization': `Bearer ${token}` },
      'shopping'
    );
    
    shoppingLatency.add(cartLatencyMs);
    shoppingSuccess.add(cartSuccessVal);
    if (!cartSuccessVal) shoppingErrors.add(1);
  });
  
  // Analytics Service
  group('Analytics Service', () => {
    // Log search (analytics ingestion)
    if (Math.random() > 0.6) {
      const { res, latency: analyticsLatencyMs, success: analyticsSuccessVal } = makeRequest(
        'POST',
        `${BASE_URL}/api/analytics/log-search`,
        {
          userId: userId || null,
          source: 'k6-limit-test',
          query: `test search ${Date.now()}`,
          results: null,
        },
        { 'Authorization': `Bearer ${token}` },
        'analytics'
      );
      
      analyticsLatency.add(analyticsLatencyMs);
      analyticsSuccess.add(analyticsSuccessVal);
      if (!analyticsSuccessVal) analyticsErrors.add(1);
    }
  });
  
  // Python AI Service
  group('Python AI Service', () => {
    // Get AI advice
    if (Math.random() > 0.85 && listingId) {
      const adviceTypes = ['selling-advice', 'buying-advice'];
      const adviceType = adviceTypes[Math.floor(Math.random() * adviceTypes.length)];
      
      const { res, latency: pythonAILatencyMs, success: pythonAISuccessVal } = makeRequest(
        'POST',
        `${BASE_URL}/api/ai/${adviceType}`,
        {
          query: `test query for ${listingId}`,
        },
        { 'Authorization': `Bearer ${token}` },
        'python_ai'
      );
      
      pythonAILatency.add(pythonAILatencyMs);
      pythonAISuccess.add(pythonAISuccessVal);
      if (!pythonAISuccessVal) pythonAIErrors.add(1);
    }
  });
  
  // Calculate overall success rate (only if metrics have values)
  // Note: During initial iterations, metrics may not have values yet
  try {
    const rates = [
      authSuccess.values?.rate || 0,
      recordsSuccess.values?.rate || 0,
      listingsSuccess.values?.rate || 0,
      socialSuccess.values?.rate || 0,
      shoppingSuccess.values?.rate || 0,
      analyticsSuccess.values?.rate || 0,
      pythonAISuccess.values?.rate || 0,
    ];
    const totalSuccess = rates.reduce((sum, rate) => sum + rate, 0);
    const avgSuccess = totalSuccess / 7;
    if (typeof overallSuccessRate.add === 'function') {
      overallSuccessRate.add(avgSuccess);
    }
  } catch (e) {
    // Metrics may not be initialized yet, skip
  }
  
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s random delay
}

export function handleSummary(data) {
  const extractPercentiles = (metric) => {
    if (!metric || !metric.values) return {};
    return {
      p50: metric.values['p(50)'] || null,
      p95: metric.values['p(95)'] || null,
      p99: metric.values['p(99)'] || null,
      p999: metric.values['p(99.9)'] || null,
      p9999: metric.values['p(99.99)'] || null,
      p100: metric.values['p(100)'] || metric.values.max || null,
      avg: metric.values.avg || null,
      min: metric.values.min || null,
      max: metric.values.max || null,
    };
  };
  
  const serviceMetrics = {};
  const services = ['auth', 'records', 'listings', 'social', 'shopping', 'analytics', 'python_ai'];
  
  services.forEach(service => {
    const latencyMetric = data.metrics[`${service}_latency_ms`];
    const successMetric = data.metrics[`${service}_success_rate`];
    const errorMetric = data.metrics[`${service}_errors`];
    
    serviceMetrics[service] = {
      latency: extractPercentiles(latencyMetric),
      success_rate: successMetric ? successMetric.values.rate : null,
      errors: errorMetric ? errorMetric.values.count : 0,
    };
  });
  
  // Find the limit - where did services start failing?
  console.log('\n=== LIMIT FINDING ANALYSIS ===');
  console.log(`Protocol: ${HTTP_VERSION}`);
  console.log(`Total Requests: ${data.metrics.http_reqs?.values.count || 0}`);
  console.log(`Overall Error Rate: ${((data.metrics.http_req_failed?.values.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Max VUs Reached: ${data.metrics.vus_max?.values.value || 'N/A'}`);
  
  console.log('\n=== Service Success Rates (Lower = Approaching Limit) ===');
  services.forEach(service => {
    const rate = serviceMetrics[service].success_rate;
    const errors = serviceMetrics[service].errors;
    const p95Latency = serviceMetrics[service].latency.p95;
    const status = rate > 0.95 ? '✅' : rate > 0.90 ? '⚠️ ' : '❌';
    console.log(`${status} ${service}: ${(rate * 100).toFixed(2)}% success, ${errors} errors, p95: ${p95Latency?.toFixed(2) || 'N/A'}ms`);
  });
  
  console.log('\n=== Service Latency at Peak Load ===');
  services.forEach(service => {
    const lat = serviceMetrics[service].latency;
    console.log(`${service}:`);
    console.log(`  p50:  ${lat.p50?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p95:  ${lat.p95?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99:  ${lat.p99?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p100: ${lat.p100?.toFixed(2) || 'N/A'} ms`);
    console.log(`  avg:  ${lat.avg?.toFixed(2) || 'N/A'} ms`);
  });
  
  // Determine which service hit the limit first
  const sortedServices = services
    .map(s => ({ name: s, rate: serviceMetrics[s].success_rate }))
    .sort((a, b) => (a.rate || 0) - (b.rate || 0));
  
  console.log('\n=== LIMIT ANALYSIS ===');
  if (sortedServices[0].rate < 0.95) {
    console.log(`⚠️  LIMIT FOUND: ${sortedServices[0].name} service reached limit first (${(sortedServices[0].rate * 100).toFixed(2)}% success)`);
    console.log(`   This service is the bottleneck under load.`);
  } else {
    console.log(`✅ No clear limit found - all services maintained >95% success rate`);
    console.log(`   System handled up to ${data.metrics.vus_max?.values.value || 'N/A'} VUs successfully`);
  }
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'k6-limit-analysis.json': JSON.stringify({
      timestamp: new Date().toISOString(),
      protocol: HTTP_VERSION,
      max_vus: data.metrics.vus_max?.values.value || null,
      total_requests: data.metrics.http_reqs?.values.count || 0,
      overall_error_rate: data.metrics.http_req_failed?.values.rate || 0,
      services: serviceMetrics,
    }, null, 2),
  };
}

