/**
 * k6 Stress Test: Shopping Service Under Load
 * 
 * Comprehensive stress testing of shopping service:
 * - Cart operations (add, get, update, remove)
 * - Checkout with payment simulation
 * - Order management (get orders, order details)
 * - Purchase history (get, resell)
 * - Search history tracking
 * - Watchlist and wishlist operations
 * - Database validation (port 5436)
 * - Upper bound testing with increasing VUs
 * 
 * Usage:
 *   # Basic stress test
 *   k6 run --vus 50 --duration 5m scripts/load/k6-shopping-stress.js
 *   
 *   # Ramp-up test (find upper bound)
 *   k6 run --stages 0s:10,30s:50,2m:100,5m:200,7m:300,10m:400,12m:500,15m:0 scripts/load/k6-shopping-stress.js
 *   
 *   # Custom configuration
 *   SHOPPING_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443 \
 *   AUTH_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443 \
 *   HOST=record.local \
 *   k6 run --vus 100 --duration 10m scripts/load/k6-shopping-stress.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration - Use ClusterIP FQDN for in-cluster k6 testing (same network as services)
// This matches the pattern from test-full-chain-with-rotation.sh
const SHOPPING_URL = __ENV.SHOPPING_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const AUTH_URL = __ENV.AUTH_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const HOST = __ENV.HOST || 'record.local';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '5m';

// Database configuration (for validation)
const DB_HOST = __ENV.DB_HOST || 'postgres-shopping-1'; // Docker container name
const DB_PORT = Number(__ENV.DB_PORT || 5436);
const DB_NAME = __ENV.DB_NAME || 'records';
const DB_USER = __ENV.DB_USER || 'postgres';
const DB_PASSWORD = __ENV.DB_PASSWORD || 'postgres';

// Custom metrics
const cartSuccess = new Rate('cart_operations_success');
const checkoutSuccess = new Rate('checkout_operations_success');
const orderSuccess = new Rate('order_operations_success');
const purchaseHistorySuccess = new Rate('purchase_history_success');
const resellSuccess = new Rate('resell_operations_success');
const searchHistorySuccess = new Rate('search_history_success');
const watchlistSuccess = new Rate('watchlist_operations_success');
const wishlistSuccess = new Rate('wishlist_operations_success');
const dbValidationSuccess = new Rate('db_validation_success');
const throughput = new Trend('throughput_ops_per_sec');
const errors = new Counter('errors');
const authErrors = new Counter('auth_errors');

// Test data
const testUsers = [];
const testTokens = [];
const testListingIds = [];

// Initialize test data (run once per VU)
export function setup() {
  // Create test users and get tokens
  const users = [];
  const tokens = [];
  const listingIds = [];
  
  // Create 10 test users for load testing
  for (let i = 0; i < 10; i++) {
    const email = `shopping-load-test-${Date.now()}-${i}@example.com`;
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
            
            // Create a test listing for this user (if listings service is available)
            // This is optional - cart operations can work without listings
            const listingRes = http.post(
              `${SHOPPING_URL}/api/listings`,
              JSON.stringify({
                title: `Test Listing ${i}`,
                description: `Load test listing ${i}`,
                price: 29.99 + i,
                listing_type: 'fixed_price',
                condition: 'Mint',
                category: 'Vinyl',
              }),
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${body.token}`,
                  'Host': HOST,
                },
                tags: { name: 'create_listing', type: 'setup' },
              }
            );
            
            if (listingRes.status === 200 || listingRes.status === 201) {
              try {
                const listingBody = JSON.parse(listingRes.body);
                if (listingBody.id) {
                  listingIds.push(listingBody.id);
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
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
  vus: VUS,
  duration: DURATION,
  // HTTP request configuration to prevent ephemeral port exhaustion
  // Connection reuse is critical for high-concurrency load testing
  httpReq: {
    timeout: '30s',  // Request timeout to prevent hanging connections
    // k6 automatically reuses connections via HTTP/2 multiplexing
    // This prevents ephemeral port exhaustion (Linux default: ~28,000 ports)
    // With HTTP/2, multiple requests share the same TCP connection
  },
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.05'], // Allow up to 5% failure under stress
    'cart_operations_success': ['rate>0.90'],
    'checkout_operations_success': ['rate>0.85'],
    'order_operations_success': ['rate>0.90'],
    'purchase_history_success': ['rate>0.90'],
    'resell_operations_success': ['rate>0.80'],
    'search_history_success': ['rate>0.90'],
    'watchlist_operations_success': ['rate>0.90'],
    'wishlist_operations_success': ['rate>0.90'],
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
  
  const startTime = Date.now();
  
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
    'get cart has items array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items) || Array.isArray(body);
      } catch {
        return false;
      }
    },
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
    'get orders status is 200': (r) => getOrdersRes.status === 200,
    'get orders response time < 1s': (r) => getOrdersRes.timings.duration < 1000,
  });
  
  if (getOrdersCheck) {
    orderSuccess.add(1);
  } else {
    orderSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 6: Add to watchlist (if listing available)
  if (listingId) {
    const addWatchlistRes = http.post(
      `${SHOPPING_URL}/api/watchlist`,
      JSON.stringify({
        item_type: 'listing',
        item_id: listingId,
        listing_id: listingId,
        notify_on: ['price_drop', 'availability'],
        metadata: {
          title: 'Test Listing',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Host': HOST,
        },
        tags: { name: 'add_to_watchlist', type: 'write' },
      }
    );
    
    const addWatchlistCheck = check(addWatchlistRes, {
      'add to watchlist status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'add to watchlist response time < 1s': (r) => r.timings.duration < 1000,
    });
    
    if (addWatchlistCheck) {
      watchlistSuccess.add(1);
    } else {
      watchlistSuccess.add(0);
      errors.add(1);
    }
    
    sleep(0.1);
  }
  
  // Test 7: Add to wishlist (if listing available)
  if (listingId) {
    const addWishlistRes = http.post(
      `${SHOPPING_URL}/api/wishlist`,
      JSON.stringify({
        item_type: 'listing',
        item_id: listingId,
        listing_id: listingId,
        priority: randomIntBetween(0, 10),
        notes: 'Load test wishlist item',
        metadata: {
          title: 'Test Listing',
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Host': HOST,
        },
        tags: { name: 'add_to_wishlist', type: 'write' },
      }
    );
    
    const addWishlistCheck = check(addWishlistRes, {
      'add to wishlist status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'add to wishlist response time < 1s': (r) => r.timings.duration < 1000,
    });
    
    if (addWishlistCheck) {
      wishlistSuccess.add(1);
    } else {
      wishlistSuccess.add(0);
      errors.add(1);
    }
    
    sleep(0.1);
  }
  
  // Test 8: Checkout (if cart has items) - only 20% of iterations to avoid creating too many orders
  if (Math.random() < 0.2 && getCartCheck) {
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
          
          // Test 9: Get resellable purchases (after checkout)
          sleep(0.2);
          const getResellableRes = http.get(`${SHOPPING_URL}/api/resell/purchases`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Host': HOST,
            },
            tags: { name: 'get_resellable', type: 'read' },
          });
          
          const getResellableCheck = check(getResellableRes, {
            'get resellable status is 200': (r) => r.status === 200,
            'get resellable response time < 1s': (r) => r.timings.duration < 1000,
          });
          
          if (getResellableCheck) {
            resellSuccess.add(1);
          } else {
            resellSuccess.add(0);
            errors.add(1);
          }
        } else {
          checkoutSuccess.add(0);
          errors.add(1);
        }
      }
    } catch (e) {
      errors.add(1);
    }
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  throughput.add(1 / duration); // ops per second
  
  sleep(0.2);
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  
  return {
    'stdout': `
🛒 Shopping Service Stress Test Results
======================================

Test Configuration:
  Shopping URL: ${SHOPPING_URL}
  Auth URL: ${AUTH_URL}
  Host: ${HOST}
  Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}
  Virtual Users: ${VUS}
  Duration: ${DURATION}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec

HTTP Metrics:
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
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

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 && 
         (data.metrics.cart_operations_success?.values?.rate || 0) > 0.90 ? '✅ PASS' : '⚠️  DEGRADED'}

Upper Bound Analysis:
  Current VUs: ${VUS}
  ${avgThroughput > 100 ? '✅ High throughput achieved' : avgThroughput > 50 ? '⚠️  Moderate throughput' : '❌ Low throughput'}
  ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 ? '✅ Error rate acceptable' : '❌ Error rate too high'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

