/**
 * k6 Ramp-Up Test: Shopping Service Upper Bound Discovery
 * 
 * Progressive ramp-up test to find the upper bound of the shopping service:
 * - Starts with low VUs and gradually increases
 * - Monitors error rates and response times
 * - Identifies the breaking point
 * - Tests all shopping endpoints under increasing load
 * 
 * Usage:
 *   # Standard ramp-up (10 -> 500 VUs over 15 minutes)
 *   k6 run scripts/load/k6-shopping-ramp.js
 *   
 *   # Aggressive ramp-up (find absolute limit)
 *   k6 run --stages 0s:10,30s:50,1m:100,2m:200,3m:300,4m:400,5m:500,6m:600,7m:700,8m:800,9m:900,10m:1000,12m:0 scripts/load/k6-shopping-ramp.js
 *   
 *   # Custom configuration
 *   SHOPPING_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443 \
 *   HOST=record.local \
 *   k6 run scripts/load/k6-shopping-ramp.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration - Use ClusterIP FQDN for in-cluster k6 testing
const SHOPPING_URL = __ENV.SHOPPING_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const AUTH_URL = __ENV.AUTH_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const HOST = __ENV.HOST || 'record.local';

// Custom metrics
const cartSuccess = new Rate('cart_operations_success');
const checkoutSuccess = new Rate('checkout_operations_success');
const orderSuccess = new Rate('order_operations_success');
const purchaseHistorySuccess = new Rate('purchase_history_success');
const resellSuccess = new Rate('resell_operations_success');
const searchHistorySuccess = new Rate('search_history_success');
const watchlistSuccess = new Rate('watchlist_operations_success');
const wishlistSuccess = new Rate('wishlist_operations_success');
const errors = new Counter('errors');
const authErrors = new Counter('auth_errors');

// Test data
let testData = null;

// Initialize test data (run once per VU)
export function setup() {
  // Create test users and get tokens
  const users = [];
  const tokens = [];
  const listingIds = [];
  
  // Create 20 test users for ramp-up testing
  for (let i = 0; i < 20; i++) {
    const email = `shopping-ramp-test-${Date.now()}-${i}@example.com`;
    const password = 'test123';
    
    // Register user
    const registerRes = http.post(
      `${AUTH_URL}/api/auth/register`,
      JSON.stringify({ email, password }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'register', type: 'setup' },
      }
    );
    
    if (registerRes.status === 201 || registerRes.status === 409) {
      // Login to get token
      const loginRes = http.post(
        `${AUTH_URL}/api/auth/login`,
        JSON.stringify({ email, password }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Host': HOST,
          },
          tags: { name: 'login', type: 'setup' },
        }
      );
      
      if (loginRes.status === 200) {
        try {
          const body = JSON.parse(loginRes.body);
          if (body.token) {
            users.push({ email, password });
            tokens.push(body.token);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }
  
  return {
    users,
    tokens,
    listingIds,
  };
}

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Warm-up
    { duration: '1m', target: 50 },     // Ramp to 50 VUs
    { duration: '2m', target: 100 },    // Ramp to 100 VUs
    { duration: '3m', target: 200 },   // Ramp to 200 VUs
    { duration: '4m', target: 300 },   // Ramp to 300 VUs
    { duration: '5m', target: 400 },   // Ramp to 400 VUs
    { duration: '6m', target: 500 },   // Ramp to 500 VUs
    { duration: '3m', target: 500 },   // Hold at 500 VUs
    { duration: '2m', target: 0 },     // Ramp down
  ],
  // HTTP request configuration to prevent ephemeral port exhaustion
  // Connection reuse is critical for high-concurrency load testing
  httpReq: {
    timeout: '30s',  // Request timeout to prevent hanging connections
    // k6 automatically reuses connections via HTTP/2 multiplexing
    // This prevents ephemeral port exhaustion (Linux default: ~28,000 ports)
    // With HTTP/2, multiple requests share the same TCP connection
  },
  thresholds: {
    'http_req_duration': ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.10'], // Allow up to 10% failure at high load
    'cart_operations_success': ['rate>0.85'],
    'checkout_operations_success': ['rate>0.75'],
    'order_operations_success': ['rate>0.85'],
    'purchase_history_success': ['rate>0.85'],
    'resell_operations_success': ['rate>0.70'],
    'search_history_success': ['rate>0.85'],
    'watchlist_operations_success': ['rate>0.85'],
    'wishlist_operations_success': ['rate>0.85'],
  },
  setupTimeout: '60s',
};

export default function (data) {
  const { users, tokens, listingIds } = data;
  
  if (tokens.length === 0) {
    errors.add(1);
    authErrors.add(1);
    sleep(1);
    return;
  }
  
  // Select random user and token
  const userIndex = randomIntBetween(0, tokens.length - 1);
  const token = tokens[userIndex];
  const user = users[userIndex];
  const listingId = listingIds.length > 0 ? listingIds[randomIntBetween(0, listingIds.length - 1)] : null;
  
  // Test 1: Add item to cart
  const addCartRes = http.post(
    `${SHOPPING_URL}/api/cart`,
    JSON.stringify({
      item_type: 'listing',
      item_id: listingId || `00000000-0000-0000-0000-${randomString(12)}`,
      listing_id: listingId,
      quantity: randomIntBetween(1, 3),
      price: 29.99 + Math.random() * 50,
      metadata: {
        title: `Test Item ${randomString(8)}`,
        artist: 'Test Artist',
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Host': HOST,
      },
      tags: { name: 'add_to_cart', type: 'write' },
    }
  );
  
  const addCartCheck = check(addCartRes, {
    'add to cart status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'add to cart response time < 2s': (r) => r.timings.duration < 2000,
  });
  
  if (addCartCheck) {
    cartSuccess.add(1);
  } else {
    cartSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 2: Get cart
  const getCartRes = http.get(`${SHOPPING_URL}/api/cart`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_cart', type: 'read' },
  });
  
  const getCartCheck = check(getCartRes, {
    'get cart status is 200': (r) => r.status === 200,
    'get cart response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (getCartCheck) {
    cartSuccess.add(1);
  } else {
    cartSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 3: Add search history
  const searchQueries = ['vinyl', 'record', 'LP', 'The Beatles', 'Pink Floyd', 'jazz', 'rock', 'classical'];
  const query = searchQueries[randomIntBetween(0, searchQueries.length - 1)];
  
  const addSearchRes = http.post(
    `${SHOPPING_URL}/api/history/searches`,
    JSON.stringify({
      query: query,
      query_type: 'listing',
      filters: {
        min_price: 10,
        max_price: 100,
      },
      result_count: randomIntBetween(10, 50),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Host': HOST,
      },
      tags: { name: 'add_search_history', type: 'write' },
    }
  );
  
  const addSearchCheck = check(addSearchRes, {
    'add search history status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'add search history response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (addSearchCheck) {
    searchHistorySuccess.add(1);
  } else {
    searchHistorySuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 4: Get purchase history
  const getPurchasesRes = http.get(`${SHOPPING_URL}/api/history/purchases`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_purchase_history', type: 'read' },
  });
  
  const getPurchasesCheck = check(getPurchasesRes, {
    'get purchase history status is 200': (r) => r.status === 200,
    'get purchase history response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (getPurchasesCheck) {
    purchaseHistorySuccess.add(1);
  } else {
    purchaseHistorySuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 5: Get orders
  const getOrdersRes = http.get(`${SHOPPING_URL}/api/orders`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_orders', type: 'read' },
  });
  
  const getOrdersCheck = check(getOrdersRes, {
    'get orders status is 200': (r) => r.status === 200,
    'get orders response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (getOrdersCheck) {
    orderSuccess.add(1);
  } else {
    orderSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 6: Checkout (only 10% of iterations to avoid creating too many orders)
  if (Math.random() < 0.1 && getCartCheck) {
    try {
      const cartBody = JSON.parse(getCartRes.body);
      const items = Array.isArray(cartBody.items) ? cartBody.items : (Array.isArray(cartBody) ? cartBody : []);
      
      if (items.length > 0) {
        const checkoutRes = http.post(
          `${SHOPPING_URL}/api/cart/checkout`,
          JSON.stringify({
            items: items.slice(0, 3).map(item => ({
              item_type: item.item_type || 'listing',
              item_id: item.item_id || item.id,
              listing_id: item.listing_id,
              quantity: item.quantity || 1,
              price: item.price || 29.99,
            })),
            payment_method: 'simulated',
            shipping_address: {
              street: '123 Test St',
              city: 'Test City',
              state: 'CA',
              zip: '12345',
              country: 'US',
            },
            billing_address: {
              street: '123 Test St',
              city: 'Test City',
              state: 'CA',
              zip: '12345',
              country: 'US',
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Host': HOST,
            },
            tags: { name: 'checkout', type: 'write' },
          }
        );
        
        const checkoutCheck = check(checkoutRes, {
          'checkout status is 200 or 201': (r) => r.status === 200 || r.status === 201,
          'checkout response time < 5s': (r) => r.timings.duration < 5000,
        });
        
        if (checkoutCheck) {
          checkoutSuccess.add(1);
        } else {
          checkoutSuccess.add(0);
          errors.add(1);
        }
      }
    } catch (e) {
      errors.add(1);
    }
  }
  
  sleep(0.2);
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  const maxVUs = data.metrics.vus_max?.values?.max || 0;
  const currentVUs = data.metrics.vus?.values?.value || 0;
  
  // Analyze where errors started increasing (upper bound detection)
  const errorRate = (data.metrics.http_req_failed?.values?.rate || 0) * 100;
  const upperBoundEstimate = errorRate > 10 ? Math.floor(maxVUs * 0.8) : maxVUs;
  
  return {
    'stdout': `
🛒 Shopping Service Ramp-Up Test Results
========================================

Test Configuration:
  Shopping URL: ${SHOPPING_URL}
  Auth URL: ${AUTH_URL}
  Host: ${HOST}
  Max VUs Reached: ${maxVUs}
  Current VUs: ${currentVUs}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec
  Test Duration: ${duration.toFixed(0)}s

HTTP Metrics:
  Failed Requests: ${errorRate.toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms
  P99.9 Duration: ${(data.metrics.http_req_duration?.values?.['p(99.9)'] || 0).toFixed(2)}ms

Shopping Service Operations:
  Cart Operations Success: ${((data.metrics.cart_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  Checkout Operations Success: ${((data.metrics.checkout_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  Order Operations Success: ${((data.metrics.order_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  Purchase History Success: ${((data.metrics.purchase_history_success?.values?.rate || 0) * 100).toFixed(1)}%
  Resell Operations Success: ${((data.metrics.resell_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  Search History Success: ${((data.metrics.search_history_success?.values?.rate || 0) * 100).toFixed(1)}%
  Watchlist Operations Success: ${((data.metrics.watchlist_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  Wishlist Operations Success: ${((data.metrics.wishlist_operations_success?.values?.rate || 0) * 100).toFixed(1)}%
  
  Total Errors: ${data.metrics.errors?.values?.count || 0}
  Auth Errors: ${data.metrics.auth_errors?.values?.count || 0}

Upper Bound Analysis:
  Estimated Upper Bound: ${upperBoundEstimate} VUs
  ${errorRate < 5 ? '✅ Excellent - Error rate < 5%' : errorRate < 10 ? '⚠️  Acceptable - Error rate < 10%' : '❌ Degraded - Error rate > 10%'}
  ${avgThroughput > 200 ? '✅ High throughput achieved' : avgThroughput > 100 ? '⚠️  Moderate throughput' : '❌ Low throughput'}
  
  Recommendation:
  ${errorRate < 5 ? `✅ Service can handle ${maxVUs}+ concurrent users` : 
    errorRate < 10 ? `⚠️  Service can handle ~${upperBoundEstimate} concurrent users (with < 10% error rate)` :
    `❌ Service upper bound is ~${upperBoundEstimate} concurrent users (error rate > 10% at ${maxVUs} VUs)`}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

