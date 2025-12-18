/**
 * k6 Auth Service Limit Test - Progressive Load Test
 * 
 * Finds the upper limit of auth-service by progressively increasing load:
 * - Tests all auth-service features: register, login, token validation, refresh
 * - Progressive VU increase until degradation
 * - Monitors error rates, latency, throughput
 * - Identifies breaking points for each feature
 * 
 * Usage:
 *   k6 run --out json=results.json scripts/load/k6-auth-limit-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const registerRate = new Rate('register_success');
const loginRate = new Rate('login_success');
const validateTokenRate = new Rate('validate_token_success');
const refreshTokenRate = new Rate('refresh_token_success');

const registerTime = new Trend('register_time');
const loginTime = new Trend('login_time');
const validateTokenTime = new Trend('validate_token_time');
const refreshTokenTime = new Trend('refresh_token_time');

const totalRegistrations = new Counter('total_registrations');
const totalLogins = new Counter('total_logins');
const totalTokenValidations = new Counter('total_token_validations');
const totalTokenRefreshes = new Counter('total_token_refreshes');

// Progressive stages to find limit
export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Baseline
    { duration: '1m', target: 25 },     // Light load
    { duration: '1m', target: 50 },     // Moderate load
    { duration: '1m', target: 100 },    // High load
    { duration: '1m', target: 200 },    // Very high load
    { duration: '1m', target: 300 },    // Extreme load
    { duration: '1m', target: 400 },    // Near breaking point
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
    ],
    // Feature-specific success rates
    'register_success': ['rate>0.90'],
    'login_success': ['rate>0.90'],
    'validate_token_success': ['rate>0.90'],
    'refresh_token_success': ['rate>0.90'],
  },
  setupTimeout: '120s',
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || (__ENV.IN_CLUSTER === 'true' 
  ? 'https://record.local:443'
  : 'https://record.local:30443');
const API_HOST = __ENV.API_HOST || (__ENV.IN_CLUSTER === 'true' 
  ? 'record.local'
  : 'record.local');
const API_PREFIX = '/api';

// Helper function to get common request options
function getReqOptions(token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Host': API_HOST,
    'X-Loadtest': '1',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return {
    headers: headers,
    params: {
      timeout: '30s',
    },
  };
}

// User credentials
let userTokens = {};
let userRefreshTokens = {};
let userCounter = 0;

// Helper: Register user
function registerUser(vuId) {
  const email = `k6-auth-limit-${vuId}-${Date.now()}@example.com`;
  const password = 'test123';

  const opts = getReqOptions(null);
  opts.tags = { name: 'Auth_Register' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/auth/register`,
    JSON.stringify({ email, password }),
    opts
  );

  const success = check(res, {
    'register successful (201)': (r) => r.status === 201,
    'register has token or user': (r) => {
      if (r.status === 201) {
        const body = JSON.parse(r.body);
        return body.token !== undefined || body.user !== undefined;
      }
      return false;
    },
  });

  registerRate.add(success);
  registerTime.add(res.timings.duration);

  if (success) {
    totalRegistrations.add(1);
    const body = JSON.parse(res.body);
    if (body.token) {
      userTokens[vuId] = body.token;
    }
    return { email, password, token: body.token };
  }
  return null;
}

// Helper: Login user
function loginUser(email, password) {
  const opts = getReqOptions(null);
  opts.tags = { name: 'Auth_Login' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/auth/login`,
    JSON.stringify({ email, password }),
    opts
  );

  const success = check(res, {
    'login successful (200)': (r) => r.status === 200,
    'login has token': (r) => {
      if (r.status === 200) {
        const body = JSON.parse(r.body);
        return body.token !== undefined;
      }
      return false;
    },
  });

  loginRate.add(success);
  loginTime.add(res.timings.duration);

  if (success) {
    totalLogins.add(1);
    const body = JSON.parse(res.body);
    return body.token;
  }
  return null;
}

// Helper: Validate token
function validateToken(token) {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Auth_ValidateToken' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/auth/validate`,
    JSON.stringify({}),
    opts
  );

  const success = check(res, {
    'validate successful (200)': (r) => r.status === 200,
  });

  validateTokenRate.add(success);
  validateTokenTime.add(res.timings.duration);

  if (success) {
    totalTokenValidations.add(1);
  }
  return success;
}

// Helper: Refresh token (if endpoint exists)
function refreshToken(token) {
  const opts = getReqOptions(token);
  opts.tags = { name: 'Auth_RefreshToken' };
  
  const res = http.post(
    `${BASE_URL}${API_PREFIX}/auth/refresh`,
    JSON.stringify({}),
    opts
  );

  const success = check(res, {
    'refresh successful (200)': (r) => r.status === 200,
  });

  refreshTokenRate.add(success);
  refreshTokenTime.add(res.timings.duration);

  if (success) {
    totalTokenRefreshes.add(1);
    const body = JSON.parse(res.body);
    if (body.token) {
      return body.token;
    }
  }
  return null;
}

// Main test function
export default function () {
  const vuId = __VU;
  
  group('Auth Service Limit Test', () => {
    // 1. Register new user
    group('Registration', () => {
      const user = registerUser(vuId);
      if (user) {
        userTokens[vuId] = user.token;
        sleep(0.3);
        
        // Validate the token we got from registration
        if (user.token) {
          validateToken(user.token);
          sleep(0.2);
        }
      }
    });

    // 2. Login (try with existing or new user)
    group('Login', () => {
      const email = `k6-auth-limit-${vuId}-${Date.now()}@example.com`;
      const password = 'test123';
      
      // First register, then login
      const user = registerUser(vuId);
      if (user) {
        sleep(0.2);
        const token = loginUser(user.email, user.password);
        if (token) {
          userTokens[vuId] = token;
          sleep(0.3);
          
          // Validate token after login
          validateToken(token);
        }
      }
    });

    // 3. Token operations
    group('Token Operations', () => {
      if (userTokens[vuId]) {
        // Validate token multiple times
        validateToken(userTokens[vuId]);
        sleep(0.2);
        validateToken(userTokens[vuId]);
        sleep(0.2);
        
        // Try refresh if available
        const newToken = refreshToken(userTokens[vuId]);
        if (newToken) {
          userTokens[vuId] = newToken;
        }
      }
    });
  });

  // Small random sleep to avoid thundering herd
  sleep(Math.random() * 2);
}


