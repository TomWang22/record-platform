/**
 * k6 Auth Service Limit Test - IMPROVED VERSION
 * 
 * Improved ramp pattern and request distribution:
 * - Gradual ramp-up to prevent overwhelming the system
 * - Better request distribution with jitter
 * - Realistic load testing (100 VUs peak)
 * - Stress testing option (200 VUs peak)
 * 
 * Usage:
 *   k6 run --out json=results.json scripts/load/k6-auth-limit-test-improved.js
 * 
 * For stress test (200 VUs):
 *   k6 run -e STRESS_TEST=true --out json=results.json scripts/load/k6-auth-limit-test-improved.js
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

// Progressive stages - IMPROVED RAMP
// Option 1: Realistic Production Load (default)
const realisticStages = [
  { duration: '2m', target: 10 },   // Warm-up: 10 VUs for 2 minutes
  { duration: '3m', target: 25 },   // Light load: gradual increase
  { duration: '3m', target: 50 },   // Moderate load: 2x increase over 3m
  { duration: '3m', target: 75 },   // High load: 1.5x increase
  { duration: '3m', target: 100 },  // Very high load: 1.33x increase
  { duration: '5m', target: 100 },  // Sustained load: hold at peak
  { duration: '2m', target: 0 },    // Ramp down: graceful shutdown
];

// Option 2: Stress Test (find breaking point)
const stressStages = [
  { duration: '2m', target: 10 },
  { duration: '3m', target: 25 },
  { duration: '3m', target: 50 },
  { duration: '3m', target: 100 },
  { duration: '3m', target: 150 },
  { duration: '3m', target: 200 },
  { duration: '5m', target: 200 },  // Hold at breaking point
  { duration: '2m', target: 0 },
];

// Option 3: Capacity Test (at system limits)
const capacityStages = [
  { duration: '2m', target: 10 },
  { duration: '3m', target: 20 },
  { duration: '3m', target: 40 },
  { duration: '3m', target: 60 },
  { duration: '5m', target: 60 },   // At bcrypt capacity (64)
  { duration: '3m', target: 80 },   // Slightly over capacity
  { duration: '5m', target: 80 },   // Hold to see degradation
  { duration: '2m', target: 0 },
];

// Select stages based on environment variable
const isStressTest = __ENV.STRESS_TEST === 'true';
const isCapacityTest = __ENV.CAPACITY_TEST === 'true';
const selectedStages = isStressTest ? stressStages : (isCapacityTest ? capacityStages : realisticStages);

export const options = {
  stages: selectedStages,
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
  const email = `k6-auth-improved-${vuId}-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
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
        try {
          const body = JSON.parse(r.body);
          return body.token !== undefined || body.user !== undefined;
        } catch (e) {
          return false;
        }
      }
      return false;
    },
  });

  registerRate.add(success);
  registerTime.add(res.timings.duration);

  if (success) {
    totalRegistrations.add(1);
    try {
      const body = JSON.parse(res.body);
      if (body.token) {
        userTokens[vuId] = body.token;
      }
      return { email, password, token: body.token };
    } catch (e) {
      return null;
    }
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
        try {
          const body = JSON.parse(r.body);
          return body.token !== undefined;
        } catch (e) {
          return false;
        }
      }
      return false;
    },
  });

  loginRate.add(success);
  loginTime.add(res.timings.duration);

  if (success) {
    totalLogins.add(1);
    try {
      const body = JSON.parse(res.body);
      return body.token;
    } catch (e) {
      return null;
    }
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

// Helper: Refresh token
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
    try {
      const body = JSON.parse(res.body);
      if (body.token) {
        return body.token;
      }
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Main test function
export default function () {
  const vuId = __VU;
  
  // Add jitter to prevent thundering herd
  // Random delay between 0.5-2.5 seconds to spread out requests
  sleep(Math.random() * 2 + 0.5);
  
  group('Auth Service Limit Test', () => {
    // 1. Register new user
    group('Registration', () => {
      const user = registerUser(vuId);
      if (user) {
        userTokens[vuId] = user.token;
        // Random delay before next operation
        sleep(Math.random() * 1 + 0.2);
        
        // Validate the token we got from registration
        if (user.token) {
          validateToken(user.token);
          sleep(Math.random() * 0.5 + 0.1);
        }
      } else {
        // If registration failed, wait longer before retry
        sleep(Math.random() * 3 + 1);
      }
    });

    // 2. Login (try with existing or new user)
    group('Login', () => {
      // Only try login if we have a registered user
      if (userTokens[vuId]) {
        // Use existing token, skip login
        sleep(Math.random() * 0.5 + 0.1);
      } else {
        // Try to register first, then login
        const email = `k6-auth-improved-${vuId}-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
        const password = 'test123';
        
        const user = registerUser(vuId);
        if (user) {
          sleep(Math.random() * 1 + 0.2);
          const token = loginUser(user.email, user.password);
          if (token) {
            userTokens[vuId] = token;
            sleep(Math.random() * 0.5 + 0.1);
            
            // Validate token after login
            validateToken(token);
          }
        }
      }
    });

    // 3. Token operations
    group('Token Operations', () => {
      if (userTokens[vuId]) {
        // Validate token multiple times
        validateToken(userTokens[vuId]);
        sleep(Math.random() * 0.5 + 0.1);
        validateToken(userTokens[vuId]);
        sleep(Math.random() * 0.5 + 0.1);
        
        // Try refresh if available
        const newToken = refreshToken(userTokens[vuId]);
        if (newToken) {
          userTokens[vuId] = newToken;
        }
      }
    });
  });

  // Random sleep at end to avoid synchronized completion
  sleep(Math.random() * 2 + 0.5);
}

