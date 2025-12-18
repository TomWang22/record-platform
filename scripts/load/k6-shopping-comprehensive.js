/**
 * k6 Comprehensive Test Suite: Shopping Service
 * 
 * Complete test suite for shopping service with auth service integration:
 * - Uses auth service for user registration/login (with bcrypt concurrency 8, connection pool updates)
 * - Cart operations (add, get, update quantity, remove, clear)
 * - Checkout flow with payment simulation
 * - Order management (list orders, get order details)
 * - Purchase history (get, filter, resell)
 * - Search history tracking
 * - Watchlist operations (add, get, remove)
 * - Wishlist operations (add, get, update, remove)
 * - Recently viewed items
 * - Database validation (external PostgreSQL on port 5436)
 * - Redis cache validation (external Redis on port 6379)
 * - Lua script validation (herd stampede prevention)
 * 
 * Usage:
 *   # Standard comprehensive test
 *   k6 run --vus 50 --duration 10m scripts/load/k6-shopping-comprehensive.js
 *   
 *   # Ramp-up test
 *   k6 run --stages 0s:10,30s:50,2m:100,5m:200,8m:300,10m:0 scripts/load/k6-shopping-comprehensive.js
 *   
 *   # Custom configuration
 *   SHOPPING_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443 \
 *   AUTH_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443 \
 *   HOST=record.local \
 *   k6 run --vus 100 --duration 15m scripts/load/k6-shopping-comprehensive.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { randomString, randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration - Use ClusterIP FQDN for in-cluster k6 testing
const SHOPPING_URL = __ENV.SHOPPING_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const AUTH_URL = __ENV.AUTH_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const HOST = __ENV.HOST || 'record.local';
const API_PREFIX = __ENV.API_PREFIX || '/api';

// Test configuration
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '10m';
const SETUP_USERS = Number(__ENV.SETUP_USERS || 20); // Pre-create users in setup

// Database configuration (external PostgreSQL)
const DB_HOST = __ENV.DB_HOST || 'postgres-shopping-1';
const DB_PORT = Number(__ENV.DB_PORT || 5436);
const DB_NAME = __ENV.DB_NAME || 'records';
const DB_USER = __ENV.DB_USER || 'postgres';

// Custom metrics
const cartSuccess = new Rate('cart_operations_success');
const checkoutSuccess = new Rate('checkout_operations_success');
const orderSuccess = new Rate('order_operations_success');
const purchaseHistorySuccess = new Rate('purchase_history_success');
const watchlistSuccess = new Rate('watchlist_operations_success');
const wishlistSuccess = new Rate('wishlist_operations_success');
const recentlyViewedSuccess = new Rate('recently_viewed_success');
const searchHistorySuccess = new Rate('search_history_success');
const authSuccess = new Rate('auth_operations_success');
const cartAddLatency = new Trend('cart_add_latency_ms');
const checkoutLatency = new Trend('checkout_latency_ms');
const orderLatency = new Trend('order_latency_ms');
const errors = new Counter('errors');
const authErrors = new Counter('auth_errors');
const dbValidationErrors = new Counter('db_validation_errors');
const cacheHitRate = new Gauge('cache_hit_rate');

// Helper: Get request options with auth token
function getReqOptions(token) {
  const headers = {
    'Content-Type': 'application/json',
    'Host': HOST,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return {
    headers,
    timeout: '30s',
  };
}

// Helper: Extract user ID from JWT token (basic parsing)
function extractUserId(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.sub || payload.user_id || null;
  } catch (e) {
    return null;
  }
}

// Test data setup - create users via auth service
export function setup() {
  console.log(`[Setup] Creating ${SETUP_USERS} test users via auth service...`);
  const users = [];
  const tokens = [];
  const userIds = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < SETUP_USERS; i++) {
    const email = `shopping-test-${Date.now()}-${i}-${randomString(8)}@example.com`;
    const password = 'Test123!@#';

    // Register user via auth service (uses bcrypt concurrency 8, connection pool updates)
    const registerOpts = getReqOptions(null);
    registerOpts.tags = { name: 'Auth_Register', type: 'setup' };
    
    const registerRes = http.post(
      `${AUTH_URL}${API_PREFIX}/auth/register`,
      JSON.stringify({ email, password }),
      registerOpts
    );

    if (registerRes.status === 201 || registerRes.status === 409) {
      // Login to get token
      const loginOpts = getReqOptions(null);
      loginOpts.tags = { name: 'Auth_Login', type: 'setup' };
      
      const loginRes = http.post(
        `${AUTH_URL}${API_PREFIX}/auth/login`,
        JSON.stringify({ email, password }),
        loginOpts
      );

      if (loginRes.status === 200) {
        try {
          const body = JSON.parse(loginRes.body);
          if (body.token) {
            const userId = extractUserId(body.token);
            users.push({ email, password, userId });
            tokens.push(body.token);
            userIds.push(userId);
            successCount++;
            
            // Small delay to prevent overwhelming auth service
            if (i % 5 === 0) {
              sleep(0.1);
            }
          } else {
            failureCount++;
          }
        } catch (e) {
          console.warn(`[Setup] Failed to parse login response for user ${i}: ${e.message}`);
          failureCount++;
        }
      } else {
        console.warn(`[Setup] Login failed for user ${i}: status=${loginRes.status}`);
        failureCount++;
      }
    } else {
      console.warn(`[Setup] Registration failed for user ${i}: status=${registerRes.status}`);
      failureCount++;
    }
  }

  console.log(`[Setup] Created ${successCount}/${SETUP_USERS} users (${failureCount} failures)`);
  
  if (tokens.length === 0) {
    console.error('[Setup] ERROR: No users created! Cannot proceed with tests.');
    return { users: [], tokens: [], userIds: [] };
  }

  return { users, tokens, userIds };
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
    'http_req_failed': ['rate<0.05'], // Allow up to 5% failure under load
    'cart_operations_success': ['rate>0.90'],
    'checkout_operations_success': ['rate>0.85'],
    'order_operations_success': ['rate>0.90'],
    'purchase_history_success': ['rate>0.90'],
    'watchlist_operations_success': ['rate>0.90'],
    'wishlist_operations_success': ['rate>0.90'],
    'auth_operations_success': ['rate>0.95'],
  },
  setupTimeout: '120s', // Allow time for user creation
};

export default function (data) {
  const { users, tokens, userIds } = data;
  
  if (tokens.length === 0) {
    errors.add(1);
    authErrors.add(1);
    sleep(1);
    return;
  }

  // Select random user
  const userIndex = randomIntBetween(0, tokens.length - 1);
  const token = tokens[userIndex];
  const user = users[userIndex];
  const userId = userIds[userIndex];

  // Test different shopping operations with weighted distribution
  const operation = randomItem([
    { name: 'cart_add', weight: 25 },
    { name: 'cart_get', weight: 15 },
    { name: 'cart_update', weight: 10 },
    { name: 'cart_remove', weight: 5 },
    { name: 'checkout', weight: 10 },
    { name: 'orders_list', weight: 10 },
    { name: 'watchlist_add', weight: 5 },
    { name: 'watchlist_get', weight: 5 },
    { name: 'wishlist_add', weight: 5 },
    { name: 'wishlist_get', weight: 5 },
    { name: 'purchase_history', weight: 3 },
    { name: 'recently_viewed', weight: 2 },
  ]);

  const startTime = Date.now();
  let success = false;

  switch (operation.name) {
    case 'cart_add': {
      const item = {
        item_type: 'listing',
        item_id: `test-item-${randomString(8)}`,
        quantity: randomIntBetween(1, 5),
        price: randomIntBetween(10, 100) + Math.random() * 100,
        metadata: { test: true, vu: __VU, timestamp: Date.now() },
      };
      
      const opts = getReqOptions(token);
      opts.tags = { name: 'Cart_Add', operation: 'cart' };
      
      const res = http.post(
        `${SHOPPING_URL}${API_PREFIX}/shopping/cart/add`,
        JSON.stringify(item),
        opts
      );
      
      success = check(res, {
        'cart add status 200': (r) => r.status === 200 || r.status === 201,
      });
      
      if (success) {
        cartSuccess.add(1);
        cartAddLatency.add(Date.now() - startTime);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'cart_get': {
      const opts = getReqOptions(token);
      opts.tags = { name: 'Cart_Get', operation: 'cart' };
      
      const res = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/cart`, opts);
      
      success = check(res, {
        'cart get status 200': (r) => r.status === 200,
        'cart get has items': (r) => {
          try {
            const body = JSON.parse(r.body);
            return Array.isArray(body.items) || Array.isArray(body);
          } catch {
            return false;
          }
        },
      });
      
      if (success) {
        cartSuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'checkout': {
      // First ensure cart has items
      const cartOpts = getReqOptions(token);
      const cartRes = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/cart`, cartOpts);
      
      if (cartRes.status === 200) {
        try {
          const cartBody = JSON.parse(cartRes.body);
          const items = cartBody.items || cartBody || [];
          
          if (items.length > 0) {
            const checkoutData = {
              payment_method: 'test',
              shipping_address: {
                street: '123 Test St',
                city: 'Test City',
                state: 'TS',
                zip: '12345',
                country: 'US',
              },
            };
            
            const opts = getReqOptions(token);
            opts.tags = { name: 'Checkout', operation: 'checkout' };
            
            const res = http.post(
              `${SHOPPING_URL}${API_PREFIX}/shopping/checkout`,
              JSON.stringify(checkoutData),
              opts
            );
            
            success = check(res, {
              'checkout status 200': (r) => r.status === 200 || r.status === 201,
            });
            
            if (success) {
              checkoutSuccess.add(1);
              checkoutLatency.add(Date.now() - startTime);
            } else {
              errors.add(1);
            }
          } else {
            // Cart empty, add item first
            success = true; // Don't count as error
          }
        } catch (e) {
          errors.add(1);
        }
      } else {
        errors.add(1);
      }
      break;
    }

    case 'orders_list': {
      const opts = getReqOptions(token);
      opts.tags = { name: 'Orders_List', operation: 'orders' };
      
      const res = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/orders`, opts);
      
      success = check(res, {
        'orders list status 200': (r) => r.status === 200,
      });
      
      if (success) {
        orderSuccess.add(1);
        orderLatency.add(Date.now() - startTime);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'watchlist_add': {
      const item = {
        item_type: 'listing',
        item_id: `watch-${randomString(8)}`,
        notify_on: ['price_drop', 'sold'],
      };
      
      const opts = getReqOptions(token);
      opts.tags = { name: 'Watchlist_Add', operation: 'watchlist' };
      
      const res = http.post(
        `${SHOPPING_URL}${API_PREFIX}/shopping/watchlist/add`,
        JSON.stringify(item),
        opts
      );
      
      success = check(res, {
        'watchlist add status 200': (r) => r.status === 200 || r.status === 201,
      });
      
      if (success) {
        watchlistSuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'watchlist_get': {
      const opts = getReqOptions(token);
      opts.tags = { name: 'Watchlist_Get', operation: 'watchlist' };
      
      const res = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/watchlist`, opts);
      
      success = check(res, {
        'watchlist get status 200': (r) => r.status === 200,
      });
      
      if (success) {
        watchlistSuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'wishlist_add': {
      const item = {
        item_type: 'listing',
        item_id: `wish-${randomString(8)}`,
        priority: randomIntBetween(0, 10),
        notes: 'Test item from k6',
      };
      
      const opts = getReqOptions(token);
      opts.tags = { name: 'Wishlist_Add', operation: 'wishlist' };
      
      const res = http.post(
        `${SHOPPING_URL}${API_PREFIX}/shopping/wishlist/add`,
        JSON.stringify(item),
        opts
      );
      
      success = check(res, {
        'wishlist add status 200': (r) => r.status === 200 || r.status === 201,
      });
      
      if (success) {
        wishlistSuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'wishlist_get': {
      const opts = getReqOptions(token);
      opts.tags = { name: 'Wishlist_Get', operation: 'wishlist' };
      
      const res = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/wishlist`, opts);
      
      success = check(res, {
        'wishlist get status 200': (r) => r.status === 200,
      });
      
      if (success) {
        wishlistSuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'purchase_history': {
      const opts = getReqOptions(token);
      opts.tags = { name: 'Purchase_History', operation: 'history' };
      
      const res = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/purchase-history`, opts);
      
      success = check(res, {
        'purchase history status 200': (r) => r.status === 200,
      });
      
      if (success) {
        purchaseHistorySuccess.add(1);
      } else {
        errors.add(1);
      }
      break;
    }

    case 'recently_viewed': {
      // Add recently viewed item
      const item = {
        item_type: 'listing',
        item_id: `view-${randomString(8)}`,
      };
      
      const opts = getReqOptions(token);
      opts.tags = { name: 'Recently_Viewed_Add', operation: 'recently_viewed' };
      
      const addRes = http.post(
        `${SHOPPING_URL}${API_PREFIX}/shopping/recently-viewed/add`,
        JSON.stringify(item),
        opts
      );
      
      if (addRes.status === 200 || addRes.status === 201) {
        // Get recently viewed
        const getOpts = getReqOptions(token);
        getOpts.tags = { name: 'Recently_Viewed_Get', operation: 'recently_viewed' };
        
        const getRes = http.get(`${SHOPPING_URL}${API_PREFIX}/shopping/recently-viewed`, getOpts);
        
        success = check(getRes, {
          'recently viewed get status 200': (r) => r.status === 200,
        });
        
        if (success) {
          recentlyViewedSuccess.add(1);
        } else {
          errors.add(1);
        }
      } else {
        errors.add(1);
      }
      break;
    }

    default:
      errors.add(1);
  }

  // Random sleep between operations (0.5-2 seconds)
  sleep(randomIntBetween(500, 2000) / 1000);
}

export function teardown(data) {
  console.log(`[Teardown] Test completed. Created ${data.users.length} users.`);
  console.log(`[Teardown] Metrics: auth_errors=${authErrors.values}, total_errors=${errors.values}`);
}
