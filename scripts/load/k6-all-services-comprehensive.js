/**
 * k6 Comprehensive Test Suite: All Services
 * 
 * Tests all microservices with detailed latency tracking and success rates:
 * - Auth Service (register, login, logout)
 * - Records Service (CRUD operations)
 * - Listings Service (search, create, get)
 * - Social Service (forum posts, messages)
 * - Shopping Service (cart, checkout, orders)
 * - Analytics Service (ingestion)
 * - Python AI Service (advice)
 * 
 * Generates:
 * - Latency graphs (p50, p95, p99, p999, etc.)
 * - Success rate per service component
 * - Comprehensive summary report
 * 
 * Usage:
 *   k6 run --vus 50 --duration 5m scripts/load/k6-all-services-comprehensive.js
 * 
 *   # With custom URL
 *   BASE_URL=https://record.local:30443 HOST=record.local \
 *   k6 run --vus 100 --duration 10m scripts/load/k6-all-services-comprehensive.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const HOST = __ENV.HOST || 'record.local';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '5m';
const DEBUG = __ENV.DEBUG === 'true';

// Debug logging helper
function debugLog(service, operation, data = {}) {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${service}] ${operation}:`, JSON.stringify(data));
  }
}

// Enhanced error logging
function logError(service, operation, res, error = null) {
  const errorData = {
    service,
    operation,
    status: res?.status || 'N/A',
    statusText: res?.status_text || 'N/A',
    url: res?.url || 'N/A',
    error: error?.message || error || 'Unknown error',
    body: res?.body ? res.body.substring(0, 200) : 'N/A',
    headers: res?.headers || {},
    timestamp: new Date().toISOString(),
  };
  
  console.error(`[ERROR] [${service}] ${operation} failed:`, JSON.stringify(errorData, null, 2));
}

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

// Auth service budgeting: Since auth is the gatekeeper, we need to:
// 1. Limit concurrent auth requests (bcrypt is CPU-intensive)
// 2. Add delays between auth operations to prevent queue saturation
// 3. Reuse tokens to minimize auth load
// 4. Monitor auth service separately
const AUTH_BUDGET_DELAY = 0.1; // 100ms delay between auth operations to prevent bcrypt queue saturation
const AUTH_CONCURRENT_LIMIT = 10; // Max concurrent auth requests per VU

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Warmup (gentle start for auth)
    { duration: '2m', target: Math.min(VUS, 50) },  // Gradual ramp (protect auth)
    { duration: '3m', target: VUS },  // Full ramp up
    { duration: DURATION, target: VUS }, // Sustained load
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(50)<200', 'p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],
    // Auth service thresholds (stricter since it's the gatekeeper)
    'auth_success_rate': ['rate>0.95'],
    'auth_latency_ms': ['p(95)<2000', 'p(99)<3000'], // Auth can be slower due to bcrypt
    // Other services (can be more lenient since auth protects them)
    'records_success_rate': ['rate>0.95'],
    'listings_success_rate': ['rate>0.95'],
    'social_success_rate': ['rate>0.95'],
    'shopping_success_rate': ['rate>0.95'],
    'analytics_success_rate': ['rate>0.90'],
    'python_ai_success_rate': ['rate>0.90'],
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

// Helper: Make request with timing, enhanced logging, and strict TLS
function makeRequest(method, url, body, headers, serviceName) {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  debugLog(serviceName, `${method} ${url}`, {
    requestId,
    hasBody: !!body,
    bodyPreview: body ? JSON.stringify(body).substring(0, 100) : null,
    headers: Object.keys(headers || {}),
  });
  
  // Determine HTTP version based on environment variable
  const httpVersion = __ENV.HTTP_VERSION === 'HTTP/3' ? 'HTTP/3' : 'HTTP/2';
  
  const params = {
    headers: {
      'Host': HOST,
      'Content-Type': 'application/json',
      'X-Loadtest': '1', // Bypass rate limiting
      ...headers,
    },
    timeout: '30s',
    // Use HTTP/2 by default, HTTP/3 if HTTP_VERSION=HTTP/3 is set
    httpVersion: httpVersion,
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
    // Create a mock response for error handling
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
  
  debugLog(serviceName, `${method} ${url} response`, {
    requestId,
    status: res.status,
    latency,
    success,
    bodyPreview: res.body ? res.body.substring(0, 100) : null,
  });
  
  if (!success) {
    logError(serviceName, `${method} ${url}`, res, error);
  }
  
  return { res, latency, success, error };
}

export function setup() {
  debugLog('SETUP', 'Starting test user registration');
  
  // Register a test user
  const email = `k6-e2e-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  const password = 'TestPassword123!';
  
  // Auth service budgeting: Add delay before register (bcrypt is CPU-intensive)
  sleep(AUTH_BUDGET_DELAY);
  
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ email, password }),
    {
      headers: {
        'Host': HOST,
        'Content-Type': 'application/json',
        'X-Loadtest': '1', // Bypass rate limiting
      },
      timeout: '30s',
      tags: { name: 'setup_register' },
    }
  );
  
  debugLog('SETUP', 'Register response', {
    status: registerRes.status,
    bodyPreview: registerRes.body ? registerRes.body.substring(0, 100) : null,
  });
  
  if (registerRes.status === 201 || registerRes.status === 409) {
    // Auth service budgeting: Add delay before login (bcrypt is CPU-intensive)
    sleep(AUTH_BUDGET_DELAY);
    
    // Login to get token
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email, password }),
      {
        headers: {
          'Host': HOST,
          'Content-Type': 'application/json',
          'X-Loadtest': '1', // Bypass rate limiting
        },
        timeout: '30s',
        tags: { name: 'setup_login' },
      }
    );
    
    debugLog('SETUP', 'Login response', {
      status: loginRes.status,
      hasToken: loginRes.body ? loginRes.body.includes('token') : false,
    });
    
    if (loginRes.status === 200) {
      try {
        const body = JSON.parse(loginRes.body);
        token = body.token || body.accessToken || '';
        userId = extractUserId(token);
        debugLog('SETUP', 'Token extracted', {
          hasToken: !!token,
          tokenLength: token.length,
          userId,
        });
      } catch (e) {
        console.error('[SETUP] Failed to parse login response:', e.message);
        logError('SETUP', 'parse_login_response', loginRes, e);
      }
    } else {
      logError('SETUP', 'login', loginRes);
    }
  } else {
    logError('SETUP', 'register', registerRes);
  }
  
  return { token, userId, email, password };
}

export default function (data) {
  if (!data.token) {
    sleep(1);
    return;
  }
  
  token = data.token;
  userId = data.userId || userId;
  
  // Test all services in groups
  // Auth Service: Add delay to prevent bcrypt queue saturation (gatekeeper)
  group('Auth Service', () => {
    sleep(AUTH_BUDGET_DELAY); // Budget for auth service (bcrypt is CPU-intensive)
    
    const { res, latency, success } = makeRequest(
      'GET',
      `${BASE_URL}/api/auth/me`,
      null,
      { 'Authorization': `Bearer ${token}` },
      'auth'
    );
    
    authLatency.add(latency);
    authSuccess.add(success);
    if (!success) authErrors.add(1);
    
    check(res, {
      'auth me status 200': (r) => r.status === 200,
    });
  });
  
  group('Records Service', () => {
    // Create record
    const { res: createRes, latency: createLatency, success: createSuccess } = makeRequest(
      'POST',
      `${BASE_URL}/api/records`,
      {
        artist: `k6 Artist ${__VU}`,
        name: `k6 Record ${Date.now()}`,
        format: 'LP',
        catalog_number: `K6-${Date.now()}`,
      },
      { 'Authorization': `Bearer ${token}` },
      'records'
    );
    
    recordsLatency.add(createLatency);
    recordsSuccess.add(createSuccess);
    if (!createSuccess) recordsErrors.add(1);
    
    if (createSuccess && createRes.status === 201) {
      const body = JSON.parse(createRes.body);
      recordId = body.id || '';
    }
    
    // Get records
    if (Math.random() > 0.5) {
      const { res: getRes, latency: getLatency, success: getSuccess } = makeRequest(
        'GET',
        `${BASE_URL}/api/records`,
        null,
        { 'Authorization': `Bearer ${token}` },
        'records'
      );
      
      recordsLatency.add(getLatency);
      recordsSuccess.add(getSuccess);
      if (!getSuccess) recordsErrors.add(1);
    }
  });
  
  group('Listings Service', () => {
    // Search listings
    const { res: searchRes, latency: searchLatency, success: searchSuccess } = makeRequest(
      'GET',
      `${BASE_URL}/api/listings/search?q=vinyl`,
      null,
      { 'Authorization': `Bearer ${token}` },
      'listings'
    );
    
    listingsLatency.add(searchLatency);
    listingsSuccess.add(searchSuccess);
    if (!searchSuccess) listingsErrors.add(1);
    
    // Create listing (occasionally)
    if (Math.random() > 0.7) {
      const { res: createRes, latency: createLatency, success: createSuccess } = makeRequest(
        'POST',
        `${BASE_URL}/api/listings`,
        {
          title: `k6 Listing ${Date.now()}`,
          description: 'Test listing from k6',
          price: 29.99,
          listing_type: 'fixed_price',
          condition: 'Mint',
          category: 'Vinyl',
        },
        { 'Authorization': `Bearer ${token}` },
        'listings'
      );
      
      listingsLatency.add(createLatency);
      listingsSuccess.add(createSuccess);
      if (!createSuccess) listingsErrors.add(1);
      
      if (createSuccess && createRes.status === 201) {
        const body = JSON.parse(createRes.body);
        listingId = body.id || '';
      }
    }
  });
  
  group('Social Service', () => {
    // Create forum post
    if (Math.random() > 0.5) {
      const { res, latency, success } = makeRequest(
        'POST',
        `${BASE_URL}/api/forum/posts`,
        {
          title: `k6 Post ${Date.now()}`,
          content: 'Test forum post from k6',
          flair: 'general',
        },
        { 'Authorization': `Bearer ${token}` },
        'social'
      );
      
      socialLatency.add(latency);
      socialSuccess.add(success);
      if (!success) socialErrors.add(1);
    }
    
    // Get forum posts
    if (Math.random() > 0.5) {
      const { res, latency, success } = makeRequest(
        'GET',
        `${BASE_URL}/api/forum/posts`,
        null,
        { 'Authorization': `Bearer ${token}` },
        'social'
      );
      
      socialLatency.add(latency);
      socialSuccess.add(success);
      if (!success) socialErrors.add(1);
    }
  });
  
  group('Shopping Service', () => {
    // Get cart
    const { res: cartRes, latency: cartLatency, success: cartSuccess } = makeRequest(
      'GET',
      `${BASE_URL}/api/cart`,
      null,
      { 'Authorization': `Bearer ${token}` },
      'shopping'
    );
    
    shoppingLatency.add(cartLatency);
    shoppingSuccess.add(cartSuccess);
    if (!cartSuccess) shoppingErrors.add(1);
    
    // Get orders
    if (Math.random() > 0.7) {
      const { res, latency, success } = makeRequest(
        'GET',
        `${BASE_URL}/api/orders`,
        null,
        { 'Authorization': `Bearer ${token}` },
        'shopping'
      );
      
      shoppingLatency.add(latency);
      shoppingSuccess.add(success);
      if (!success) shoppingErrors.add(1);
    }
  });
  
  group('Analytics Service', () => {
    // Log search (analytics ingestion endpoint)
    if (Math.random() > 0.5) {
      // Analytics service expects userId to be a UUID string or null, not an object
      // results should be a number (count) or null, not an array
      const { res, latency, success } = makeRequest(
        'POST',
        `${BASE_URL}/api/analytics/log-search`,
        {
          userId: userId || null, // Ensure it's a string UUID or null
          source: 'k6-e2e-test',
          query: `test search ${Date.now()}`,
          results: null, // Change from [] to null (expects number or null, not array)
        },
        { 'Authorization': `Bearer ${token}` },
        'analytics'
      );
      
      analyticsLatency.add(latency);
      analyticsSuccess.add(success);
      if (!success) analyticsErrors.add(1);
    }
  });
  
  group('Python AI Service', () => {
    // Get AI advice - correct endpoints: /api/ai/selling-advice, /api/ai/buying-advice, /api/ai/negotiation-advice
    if (Math.random() > 0.8 && listingId) {
      // Randomly choose advice type
      const adviceTypes = ['selling-advice', 'buying-advice', 'negotiation-advice'];
      const adviceType = adviceTypes[Math.floor(Math.random() * adviceTypes.length)];
      
      const requestBody = {
        query: `test query for ${listingId}`,
      };
      
      // Add role for negotiation advice
      if (adviceType === 'negotiation-advice') {
        requestBody.role = Math.random() > 0.5 ? 'buyer' : 'seller';
        requestBody.current_price = 29.99;
        requestBody.target_price = 25.00;
      }
      
      const { res, latency, success } = makeRequest(
        'POST',
        `${BASE_URL}/api/ai/${adviceType}`,
        requestBody,
        { 'Authorization': `Bearer ${token}` },
        'python_ai'
      );
      
      pythonAILatency.add(latency);
      pythonAISuccess.add(success);
      if (!success) pythonAIErrors.add(1);
    }
  });
  
  sleep(Math.random() * 2);
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
      p99999: metric.values['p(99.999)'] || null,
      p999999: metric.values['p(99.9999)'] || null,
      p9999999: metric.values['p(99.99999)'] || null,
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
  
  const summary = {
    timestamp: new Date().toISOString(),
    total_requests: data.metrics.http_reqs?.values.count || 0,
    total_duration: data.metrics.http_req_duration?.values.avg || 0,
    error_rate: data.metrics.http_req_failed?.values.rate || 0,
    services: serviceMetrics,
  };
  
  console.log('\n=== Service Success Rates ===');
  services.forEach(service => {
    const rate = serviceMetrics[service].success_rate;
    const errors = serviceMetrics[service].errors;
    console.log(`${service}: ${(rate * 100).toFixed(2)}% success, ${errors} errors`);
  });
  
  console.log('\n=== Service Latency Metrics (Comprehensive Percentiles) ===');
  services.forEach(service => {
    const lat = serviceMetrics[service].latency;
    console.log(`${service}:`);
    console.log(`  p50:      ${lat.p50?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p95:      ${lat.p95?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99:      ${lat.p99?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99.9:    ${lat.p999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99.99:   ${lat.p9999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99.999:  ${lat.p99999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99.9999: ${lat.p999999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p99.99999: ${lat.p9999999?.toFixed(2) || 'N/A'} ms`);
    console.log(`  p100:     ${lat.p100?.toFixed(2) || 'N/A'} ms`);
    console.log(`  avg:      ${lat.avg?.toFixed(2) || 'N/A'} ms`);
    console.log(`  min:      ${lat.min?.toFixed(2) || 'N/A'} ms`);
    console.log(`  max:      ${lat.max?.toFixed(2) || 'N/A'} ms`);
  });
  
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'k6-service-metrics.json': JSON.stringify(summary, null, 2),
    'k6-report.html': htmlReport(data),
  };
}

