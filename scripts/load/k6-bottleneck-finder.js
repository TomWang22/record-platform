/**
 * k6 Bottleneck Finder - Progressive Load Test
 * 
 * Finds the upper limit of virtual users and identifies bottlenecks:
 * - Progressive VU increase until degradation
 * - Monitors error rates, latency, throughput
 * - Identifies breaking points
 * - Reports bottleneck analysis
 * 
 * Usage:
 *   k6 run --vus 10 --duration 2m scripts/load/k6-bottleneck-finder.js
 *   k6 run --stages 0s:10,30s:20,1m:50,2m:100,3m:200,4m:300,5m:400,6m:500,7m:0 scripts/load/k6-bottleneck-finder.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const API_PATH = __ENV.API_PATH || '/api';
const AUTH_URL = __ENV.AUTH_URL || `${BASE_URL}${API_PATH}/auth`;
const SHOPPING_URL = __ENV.SHOPPING_URL || `${BASE_URL}${API_PATH}/cart`;
const ORDERS_URL = __ENV.ORDERS_URL || `${BASE_URL}${API_PATH}/orders`;
const LISTINGS_URL = __ENV.LISTINGS_URL || `${BASE_URL}${API_PATH}/listings`;
const HOST = __ENV.HOST || 'record.local';
const TOKEN = __ENV.TOKEN;

// Bottleneck detection thresholds
const ERROR_RATE_THRESHOLD = 0.05; // 5% error rate indicates degradation
const LATENCY_P95_THRESHOLD = 3000; // 3 seconds p95 indicates degradation
const LATENCY_P99_THRESHOLD = 5000; // 5 seconds p99 indicates degradation

// Custom metrics for bottleneck analysis
const errorRate = new Rate('error_rate');
const requestDuration = new Trend('request_duration');
const throughput = new Counter('throughput');
const authErrors = new Counter('auth_errors');
const timeoutErrors = new Counter('timeout_errors');
const serverErrors = new Counter('server_errors');
const clientErrors = new Counter('client_errors');

// Test data
let testData = null;

// Initialize test data
export function setup() {
  const users = [];
  const tokens = [];
  const listingIds = [];
  
  // Create test users and get tokens
  for (let i = 0; i < 50; i++) {
    const email = `testuser${i}@bottleneck-test.com`;
    const password = `password${i}123`;
    
    // Register user
    const registerRes = http.post(`${AUTH_URL}/register`, JSON.stringify({
      email,
      password,
      name: `Test User ${i}`
    }), {
      headers: { 'Content-Type': 'application/json', 'Host': HOST },
      tags: { name: 'Register' }
    });
    
    if (registerRes.status === 201 || registerRes.status === 409) {
      // Login to get token
      const loginRes = http.post(`${AUTH_URL}/login`, JSON.stringify({
        email,
        password
      }), {
        headers: { 'Content-Type': 'application/json', 'Host': HOST },
        tags: { name: 'Login' }
      });
      
      if (loginRes.status === 200) {
        const token = JSON.parse(loginRes.body).token;
        if (token) {
          users.push({ email, password });
          tokens.push(token);
        }
      }
    }
  }
  
  // Get some listing IDs
  const listingsRes = http.get(`${LISTINGS_URL}?limit=20`, {
    headers: { 'Host': HOST },
    tags: { name: 'GetListings' }
  });
  
  if (listingsRes.status === 200) {
    const listings = JSON.parse(listingsRes.body);
    if (Array.isArray(listings)) {
      listings.forEach(listing => {
        if (listing.id) listingIds.push(listing.id);
      });
    }
  }
  
  return {
    users,
    tokens,
    listingIds,
  };
}

// Progressive stages to find bottleneck
export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Baseline
    { duration: '1m', target: 25 },     // Light load
    { duration: '1m', target: 50 },     // Moderate load
    { duration: '1m', target: 100 },    // High load
    { duration: '1m', target: 200 },    // Very high load
    { duration: '1m', target: 300 },    // Extreme load
    { duration: '1m', target: 400 },     // Near breaking point
    { duration: '1m', target: 500 },    // Breaking point test
    { duration: '2m', target: 500 },    // Hold at max to identify sustained bottlenecks
    { duration: '1m', target: 0 },      // Ramp down
  ],
  thresholds: {
    // Error rate thresholds - key bottleneck indicator
    'http_req_failed': [
      'rate<0.01',  // Excellent: < 1% errors
      'rate<0.05',  // Acceptable: < 5% errors
      'rate<0.10',  // Degraded: < 10% errors
    ],
    // Latency thresholds - identify performance degradation
    'http_req_duration': [
      'p(50)<500',   // Median should be < 500ms
      'p(75)<1000',  // 75th percentile < 1s
      'p(90)<2000',  // 90th percentile < 2s
      'p(95)<3000',  // 95th percentile < 3s (bottleneck threshold)
      'p(99)<5000',  // 99th percentile < 5s (severe bottleneck)
      'p(99.9)<10000', // 99.9th percentile < 10s
    ],
    // Throughput thresholds
    'http_reqs': ['rate>10'], // Minimum 10 req/s
    // Custom error metrics
    'error_rate': ['rate<0.05'],
    'timeout_errors': ['count<100'],
    'server_errors': ['count<50'],
  },
  setupTimeout: '120s',
};

export default function (data) {
  const { users, tokens, listingIds } = data;
  
  if (tokens.length === 0) {
    errorRate.add(1);
    authErrors.add(1);
    sleep(1);
    return;
  }
  
  // Select random user and token
  const userIndex = randomIntBetween(0, tokens.length - 1);
  const token = tokens[userIndex];
  const listingId = listingIds.length > 0 ? listingIds[randomIntBetween(0, listingIds.length - 1)] : null;
  
  const headers = {
    'Content-Type': 'application/json',
    'Host': HOST,
    'Authorization': `Bearer ${token}`
  };
  
  // Test various endpoints to find bottlenecks
  const operations = [
    // Shopping cart operations
    () => {
      const res = http.get(`${SHOPPING_URL}`, { headers, tags: { name: 'GetCart' } });
      const success = check(res, {
        'cart get status 200': (r) => r.status === 200,
        'cart get response time < 2s': (r) => r.timings.duration < 2000,
      });
      if (!success) errorRate.add(1);
      if (res.status >= 500) serverErrors.add(1);
      if (res.status >= 400 && res.status < 500) clientErrors.add(1);
      if (res.timings.duration > 30000) timeoutErrors.add(1);
      requestDuration.add(res.timings.duration);
      throughput.add(1);
      return res;
    },
    // Add to cart
    () => {
      if (!listingId) return null;
      const res = http.post(`${SHOPPING_URL}/items`, JSON.stringify({
        listingId,
        quantity: 1
      }), { headers, tags: { name: 'AddToCart' } });
      const success = check(res, {
        'add to cart status 200/201': (r) => r.status === 200 || r.status === 201,
        'add to cart response time < 3s': (r) => r.timings.duration < 3000,
      });
      if (!success) errorRate.add(1);
      if (res.status >= 500) serverErrors.add(1);
      if (res.status >= 400 && res.status < 500) clientErrors.add(1);
      if (res.timings.duration > 30000) timeoutErrors.add(1);
      requestDuration.add(res.timings.duration);
      throughput.add(1);
      return res;
    },
    // Get orders
    () => {
      const res = http.get(`${ORDERS_URL}`, { headers, tags: { name: 'GetOrders' } });
      const success = check(res, {
        'orders get status 200': (r) => r.status === 200,
        'orders get response time < 2s': (r) => r.timings.duration < 2000,
      });
      if (!success) errorRate.add(1);
      if (res.status >= 500) serverErrors.add(1);
      if (res.status >= 400 && res.status < 500) clientErrors.add(1);
      if (res.timings.duration > 30000) timeoutErrors.add(1);
      requestDuration.add(res.timings.duration);
      throughput.add(1);
      return res;
    },
    // Get listings (read-heavy operation)
    () => {
      const res = http.get(`${LISTINGS_URL}?limit=10`, { headers: { 'Host': HOST }, tags: { name: 'GetListings' } });
      const success = check(res, {
        'listings get status 200': (r) => r.status === 200,
        'listings get response time < 1s': (r) => r.timings.duration < 1000,
      });
      if (!success) errorRate.add(1);
      if (res.status >= 500) serverErrors.add(1);
      if (res.status >= 400 && res.status < 500) clientErrors.add(1);
      if (res.timings.duration > 30000) timeoutErrors.add(1);
      requestDuration.add(res.timings.duration);
      throughput.add(1);
      return res;
    },
  ];
  
  // Execute random operations
  const operation = operations[randomIntBetween(0, operations.length - 1)];
  operation();
  
  sleep(randomIntBetween(1, 3));
}

// Analyze bottlenecks and generate report
export function handleSummary(data) {
  const metrics = data.metrics;
  const state = data.state;
  
  // Extract key metrics
  const maxVUs = metrics.vus_max?.values?.max || 0;
  const currentVUs = metrics.vus?.values?.value || 0;
  const totalRequests = metrics.http_reqs?.values?.count || 0;
  const duration = (state.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalRequests / duration : 0;
  
  // Error analysis
  const errorRate = (metrics.http_req_failed?.values?.rate || 0) * 100;
  const timeoutErrors = metrics.timeout_errors?.values?.count || 0;
  const serverErrors = metrics.server_errors?.values?.count || 0;
  const clientErrors = metrics.client_errors?.values?.count || 0;
  
  // Latency analysis
  const latency = metrics.http_req_duration?.values || {};
  const p50 = (latency['p(50)'] || 0) * 1000;
  const p75 = (latency['p(75)'] || 0) * 1000;
  const p90 = (latency['p(90)'] || 0) * 1000;
  const p95 = (latency['p(95)'] || 0) * 1000;
  const p99 = (latency['p(99)'] || 0) * 1000;
  const p999 = (latency['p(99.9)'] || 0) * 1000;
  const maxLatency = (latency.max || 0) * 1000;
  const avgLatency = (latency.avg || 0) * 1000;
  
  // Bottleneck detection
  const bottlenecks = [];
  
  // Error rate bottleneck
  if (errorRate > 5) {
    bottlenecks.push({
      type: 'ERROR_RATE',
      severity: errorRate > 10 ? 'CRITICAL' : 'HIGH',
      description: `Error rate is ${errorRate.toFixed(2)}% (threshold: 5%)`,
      recommendation: 'Check server logs, database connections, and resource limits'
    });
  }
  
  // Latency bottleneck
  if (p95 > LATENCY_P95_THRESHOLD) {
    bottlenecks.push({
      type: 'LATENCY_P95',
      severity: p95 > 5000 ? 'CRITICAL' : 'HIGH',
      description: `P95 latency is ${p95.toFixed(0)}ms (threshold: ${LATENCY_P95_THRESHOLD}ms)`,
      recommendation: 'Optimize database queries, add caching, or scale horizontally'
    });
  }
  
  if (p99 > LATENCY_P99_THRESHOLD) {
    bottlenecks.push({
      type: 'LATENCY_P99',
      severity: 'CRITICAL',
      description: `P99 latency is ${p99.toFixed(0)}ms (threshold: ${LATENCY_P99_THRESHOLD}ms)`,
      recommendation: 'Investigate slow queries, connection pool limits, or network issues'
    });
  }
  
  // Timeout bottleneck
  if (timeoutErrors > 50) {
    bottlenecks.push({
      type: 'TIMEOUTS',
      severity: 'HIGH',
      description: `${timeoutErrors} timeout errors detected`,
      recommendation: 'Increase timeout values or optimize slow endpoints'
    });
  }
  
  // Server error bottleneck
  if (serverErrors > 20) {
    bottlenecks.push({
      type: 'SERVER_ERRORS',
      severity: 'CRITICAL',
      description: `${serverErrors} server errors (5xx) detected`,
      recommendation: 'Check application logs, database connections, and resource exhaustion'
    });
  }
  
  // Client error bottleneck
  if (clientErrors > 100) {
    bottlenecks.push({
      type: 'CLIENT_ERRORS',
      severity: 'MEDIUM',
      description: `${clientErrors} client errors (4xx) detected`,
      recommendation: 'Review request validation and authentication logic'
    });
  }
  
  // Throughput bottleneck
  if (avgThroughput < 10 && maxVUs > 100) {
    bottlenecks.push({
      type: 'THROUGHPUT',
      severity: 'HIGH',
      description: `Low throughput: ${avgThroughput.toFixed(2)} req/s with ${maxVUs} VUs`,
      recommendation: 'Optimize request processing or increase server capacity'
    });
  }
  
  // Calculate upper bound VU limit
  let upperBoundVUs = maxVUs;
  if (errorRate > 10) {
    upperBoundVUs = Math.floor(maxVUs * 0.7); // If >10% errors, limit is ~70% of max
  } else if (errorRate > 5) {
    upperBoundVUs = Math.floor(maxVUs * 0.85); // If >5% errors, limit is ~85% of max
  } else if (p95 > LATENCY_P95_THRESHOLD) {
    upperBoundVUs = Math.floor(maxVUs * 0.8); // If latency high, limit is ~80% of max
  }
  
  // Generate report
  const report = `
🔍 BOTTLENECK ANALYSIS REPORT
================================

Test Configuration:
  Base URL: ${BASE_URL}
  Max VUs Reached: ${maxVUs}
  Current VUs: ${currentVUs}
  Test Duration: ${duration.toFixed(0)}s
  Total Requests: ${totalRequests}
  Avg Throughput: ${avgThroughput.toFixed(2)} req/s

ERROR ANALYSIS:
  Error Rate: ${errorRate.toFixed(2)}% ${errorRate > 5 ? '⚠️  BOTTLENECK' : errorRate > 1 ? '⚠️' : '✅'}
  Timeout Errors: ${timeoutErrors} ${timeoutErrors > 50 ? '⚠️  BOTTLENECK' : '✅'}
  Server Errors (5xx): ${serverErrors} ${serverErrors > 20 ? '⚠️  BOTTLENECK' : '✅'}
  Client Errors (4xx): ${clientErrors} ${clientErrors > 100 ? '⚠️  BOTTLENECK' : '✅'}

LATENCY ANALYSIS (ms):
  Average: ${avgLatency.toFixed(0)}ms
  Median (P50): ${p50.toFixed(0)}ms
  P75: ${p75.toFixed(0)}ms
  P90: ${p90.toFixed(0)}ms
  P95: ${p95.toFixed(0)}ms ${p95 > LATENCY_P95_THRESHOLD ? '⚠️  BOTTLENECK' : '✅'}
  P99: ${p99.toFixed(0)}ms ${p99 > LATENCY_P99_THRESHOLD ? '⚠️  BOTTLENECK' : '✅'}
  P99.9: ${p999.toFixed(0)}ms
  Max: ${maxLatency.toFixed(0)}ms

BOTTLENECKS IDENTIFIED: ${bottlenecks.length}
${bottlenecks.length > 0 ? bottlenecks.map((b, i) => `
  ${i + 1}. [${b.severity}] ${b.type}
     Issue: ${b.description}
     Recommendation: ${b.recommendation}
`).join('') : '  ✅ No critical bottlenecks detected'}

UPPER BOUND ANALYSIS:
  Estimated Max VUs: ${upperBoundVUs}
  ${errorRate < 5 && p95 < LATENCY_P95_THRESHOLD ? 
    `✅ Service can handle ${maxVUs}+ concurrent users with < 5% error rate` :
    errorRate < 10 && p95 < 5000 ?
    `⚠️  Service can handle ~${upperBoundVUs} concurrent users (with ${errorRate.toFixed(1)}% error rate)` :
    `❌ Service upper bound is ~${upperBoundVUs} concurrent users (degraded performance at ${maxVUs} VUs)`}

RECOMMENDATIONS:
${bottlenecks.length === 0 ? 
  '  ✅ System is performing well. Consider stress testing with higher VUs.' :
  bottlenecks.map(b => `  - ${b.recommendation}`).join('\n')}
`;
  
  return {
    'stdout': report,
    'bottleneck-analysis.json': JSON.stringify({
      summary: {
        maxVUs,
        currentVUs,
        totalRequests,
        duration,
        avgThroughput,
        upperBoundVUs,
      },
      errors: {
        errorRate,
        timeoutErrors,
        serverErrors,
        clientErrors,
      },
      latency: {
        avg: avgLatency,
        p50,
        p75,
        p90,
        p95,
        p99,
        p999,
        max: maxLatency,
      },
      bottlenecks,
      timestamp: new Date().toISOString(),
    }, null, 2),
  };
}

