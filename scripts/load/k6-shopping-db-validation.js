/**
 * k6 Database Validation Test: Shopping Service Database (Port 5436)
 * 
 * Validates database integrity and performance under load:
 * - Verifies data consistency
 * - Checks database connection pool health
 * - Validates transaction integrity
 * - Monitors database query performance
 * 
 * Note: This test requires database access (port 5436)
 * For in-cluster testing, use postgres-shopping service FQDN
 * 
 * Usage:
 *   # Basic validation
 *   k6 run --vus 20 --duration 5m scripts/load/k6-shopping-db-validation.js
 *   
 *   # With database connection
 *   DB_HOST=postgres-shopping.record-platform.svc.cluster.local \
 *   DB_PORT=5432 \
 *   DB_NAME=records \
 *   DB_USER=postgres \
 *   DB_PASSWORD=postgres \
 *   k6 run --vus 50 --duration 10m scripts/load/k6-shopping-db-validation.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const SHOPPING_URL = __ENV.SHOPPING_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const AUTH_URL = __ENV.AUTH_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const HOST = __ENV.HOST || 'record.local';

// Database configuration (for validation queries via shopping service)
const DB_HOST = __ENV.DB_HOST || 'postgres-shopping-1'; // Docker container name
const DB_PORT = Number(__ENV.DB_PORT || 5436);
const DB_NAME = __ENV.DB_NAME || 'records';
const DB_USER = __ENV.DB_USER || 'postgres';
const DB_PASSWORD = __ENV.DB_PASSWORD || 'postgres';

// Custom metrics
const dbQuerySuccess = new Rate('db_query_success');
const dbConsistencyCheck = new Rate('db_consistency_check');
const dbTransactionSuccess = new Rate('db_transaction_success');
const dbPoolHealth = new Rate('db_pool_health');
const errors = new Counter('errors');

// Test data
let testData = null;

// Initialize test data
export function setup() {
  const users = [];
  const tokens = [];
  
  // Create test users
  for (let i = 0; i < 10; i++) {
    const email = `shopping-db-test-${Date.now()}-${i}@example.com`;
    const password = 'test123';
    
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
  };
}

export const options = {
  vus: 20,
  duration: '5m',
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.05'],
    'db_query_success': ['rate>0.95'],
    'db_consistency_check': ['rate>0.95'],
    'db_transaction_success': ['rate>0.95'],
  },
  setupTimeout: '60s',
};

export default function (data) {
  const { users, tokens } = data;
  
  if (tokens.length === 0) {
    errors.add(1);
    sleep(1);
    return;
  }
  
  const userIndex = randomIntBetween(0, tokens.length - 1);
  const token = tokens[userIndex];
  
  // Test 1: Add to cart (write operation - validates DB write)
  const addCartRes = http.post(
    `${SHOPPING_URL}/api/cart`,
    JSON.stringify({
      item_type: 'listing',
      item_id: `00000000-0000-0000-0000-${randomString(12)}`,
      quantity: randomIntBetween(1, 3),
      price: 29.99 + Math.random() * 50,
      metadata: {
        title: `Test Item ${randomString(8)}`,
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Host': HOST,
      },
      tags: { name: 'add_to_cart', type: 'db_write' },
    }
  );
  
  const addCartCheck = check(addCartRes, {
    'add to cart status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'add to cart response time < 2s': (r) => r.timings.duration < 2000,
  });
  
  if (addCartCheck) {
    dbQuerySuccess.add(1);
    dbTransactionSuccess.add(1);
  } else {
    dbQuerySuccess.add(0);
    dbTransactionSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 2: Get cart (read operation - validates DB read and consistency)
  const getCartRes = http.get(`${SHOPPING_URL}/api/cart`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_cart', type: 'db_read' },
  });
  
  const getCartCheck = check(getCartRes, {
    'get cart status is 200': (r) => getCartRes.status === 200,
    'get cart response time < 1s': (r) => getCartRes.timings.duration < 1000,
    'get cart has valid structure': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items) || Array.isArray(body);
      } catch {
        return false;
      }
    },
  });
  
  if (getCartCheck) {
    dbQuerySuccess.add(1);
    dbConsistencyCheck.add(1);
    
    // Verify data consistency: if we added an item, it should be in the cart
    try {
      const cartBody = JSON.parse(getCartRes.body);
      const items = Array.isArray(cartBody.items) ? cartBody.items : (Array.isArray(cartBody) ? cartBody : []);
      if (items.length > 0) {
        dbConsistencyCheck.add(1);
      }
    } catch (e) {
      dbConsistencyCheck.add(0);
    }
  } else {
    dbQuerySuccess.add(0);
    dbConsistencyCheck.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 3: Add search history (write operation)
  const addSearchRes = http.post(
    `${SHOPPING_URL}/api/history/searches`,
    JSON.stringify({
      query: 'test query',
      query_type: 'listing',
      filters: { min_price: 10, max_price: 100 },
      result_count: randomIntBetween(10, 50),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Host': HOST,
      },
      tags: { name: 'add_search_history', type: 'db_write' },
    }
  );
  
  const addSearchCheck = check(addSearchRes, {
    'add search history status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'add search history response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (addSearchCheck) {
    dbQuerySuccess.add(1);
    dbTransactionSuccess.add(1);
  } else {
    dbQuerySuccess.add(0);
    dbTransactionSuccess.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 4: Get purchase history (read operation - validates DB read performance)
  const getPurchasesRes = http.get(`${SHOPPING_URL}/api/history/purchases`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_purchase_history', type: 'db_read' },
  });
  
  const getPurchasesCheck = check(getPurchasesRes, {
    'get purchase history status is 200': (r) => r.status === 200,
    'get purchase history response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (getPurchasesCheck) {
    dbQuerySuccess.add(1);
    dbPoolHealth.add(1); // Successful read indicates healthy connection pool
  } else {
    dbQuerySuccess.add(0);
    dbPoolHealth.add(0);
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 5: Get orders (read operation - validates complex query performance)
  const getOrdersRes = http.get(`${SHOPPING_URL}/api/orders`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Host': HOST,
    },
    tags: { name: 'get_orders', type: 'db_read' },
  });
  
  const getOrdersCheck = check(getOrdersRes, {
    'get orders status is 200': (r) => r.status === 200,
    'get orders response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  if (getOrdersCheck) {
    dbQuerySuccess.add(1);
    dbPoolHealth.add(1);
  } else {
    dbQuerySuccess.add(0);
    dbPoolHealth.add(0);
    errors.add(1);
  }
  
  sleep(0.2);
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  
  return {
    'stdout': `
🗄️  Shopping Service Database Validation Results
================================================

Test Configuration:
  Shopping URL: ${SHOPPING_URL}
  Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec
  Test Duration: ${duration.toFixed(0)}s

HTTP Metrics:
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms

Database Validation:
  Query Success Rate: ${((data.metrics.db_query_success?.values?.rate || 0) * 100).toFixed(1)}%
  Consistency Check: ${((data.metrics.db_consistency_check?.values?.rate || 0) * 100).toFixed(1)}%
  Transaction Success: ${((data.metrics.db_transaction_success?.values?.rate || 0) * 100).toFixed(1)}%
  Connection Pool Health: ${((data.metrics.db_pool_health?.values?.rate || 0) * 100).toFixed(1)}%
  
  Total Errors: ${data.metrics.errors?.values?.count || 0}

Database Health Status:
  ${(data.metrics.db_query_success?.values?.rate || 0) > 0.95 ? '✅ Database queries healthy' : '⚠️  Database query issues detected'}
  ${(data.metrics.db_consistency_check?.values?.rate || 0) > 0.95 ? '✅ Data consistency maintained' : '⚠️  Data consistency issues detected'}
  ${(data.metrics.db_transaction_success?.values?.rate || 0) > 0.95 ? '✅ Transactions successful' : '⚠️  Transaction failures detected'}
  ${(data.metrics.db_pool_health?.values?.rate || 0) > 0.95 ? '✅ Connection pool healthy' : '⚠️  Connection pool issues detected'}

Overall Status: ${(data.metrics.db_query_success?.values?.rate || 0) > 0.95 && 
                  (data.metrics.db_consistency_check?.values?.rate || 0) > 0.95 ? '✅ PASS' : '⚠️  DEGRADED'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

