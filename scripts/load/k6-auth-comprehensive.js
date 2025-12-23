import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// Custom metrics
const registerSuccessRate = new Rate('register_success');
const registerDuplicateRate = new Rate('register_duplicate'); // 409 is expected
const loginSuccessRate = new Rate('login_success');
const validateSuccessRate = new Rate('validate_success');
const refreshSuccessRate = new Rate('refresh_success');
const logoutSuccessRate = new Rate('logout_success');

const registerLatency = new Trend('register_latency');
const loginLatency = new Trend('login_latency');
const validateLatency = new Trend('validate_latency');
const refreshLatency = new Trend('refresh_latency');
const logoutLatency = new Trend('logout_latency');

const registerErrors = new Counter('register_errors');
const loginErrors = new Counter('login_errors');
const validateErrors = new Counter('validate_errors');
const refreshErrors = new Counter('refresh_errors');
const logoutErrors = new Counter('logout_errors');

// Debug logging
const DEBUG = __ENV.DEBUG === 'true';

function debugLog(message, data = {}) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`, JSON.stringify(data));
  }
}

// Test configuration
export const options = {
  stages: [
    // Warm-up: 1 VU for 1 minute
    { duration: '1m', target: 1 },
    // Incremental ramp: 1 -> 5 VUs over 2 minutes
    { duration: '2m', target: 5 },
    // Hold: 5 VUs for 2 minutes
    { duration: '2m', target: 5 },
    // Incremental ramp: 5 -> 10 VUs over 2 minutes
    { duration: '2m', target: 10 },
    // Hold: 10 VUs for 2 minutes
    { duration: '2m', target: 10 },
    // Incremental ramp: 10 -> 20 VUs over 2 minutes
    { duration: '2m', target: 20 },
    // Hold: 20 VUs for 2 minutes
    { duration: '2m', target: 20 },
    // Incremental ramp: 20 -> 50 VUs over 3 minutes
    { duration: '3m', target: 50 },
    // Hold: 50 VUs for 3 minutes
    { duration: '3m', target: 50 },
    // Incremental ramp: 50 -> 100 VUs over 3 minutes
    { duration: '3m', target: 100 },
    // Hold: 100 VUs for 5 minutes (stress test)
    { duration: '5m', target: 100 },
    // Cool-down: 100 -> 0 VUs over 2 minutes
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    // Success rate thresholds (should be high)
    'register_success': ['rate>0.90'],  // 90% success (409 is expected for duplicates)
    'register_duplicate': ['rate<0.10'], // <10% duplicates (expected)
    'login_success': ['rate>0.99'],     // 99% success rate
    'validate_success': ['rate>0.99'],   // 99% success rate
    'refresh_success': ['rate>0.99'],    // 99% success rate
    'logout_success': ['rate>0.99'],     // 99% success rate
    
    // Latency thresholds (P95 should be reasonable)
    'register_latency': ['p(95)<2000'],  // P95 < 2s
    'login_latency': ['p(95)<1000'],     // P95 < 1s
    'validate_latency': ['p(95)<500'],   // P95 < 500ms
    'refresh_latency': ['p(95)<500'],    // P95 < 500ms
    'logout_latency': ['p(95)<500'],     // P95 < 500ms
    
    // HTTP errors (excluding 409 for duplicates)
    'http_req_failed': ['rate<0.05'],    // < 5% HTTP errors
    'http_req_duration': ['p(95)<2000'], // P95 < 2s
  },
  // Strict TLS - no insecure skip
  tlsVersion: {
    min: 'tls1.2',
    max: 'tls1.3',
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const API_PREFIX = __ENV.API_PREFIX || '/api';

// Helper: Generate unique email
function generateEmail() {
  return `load-test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
}

// Helper: Register a new user
function registerUser(email, password) {
  const url = `${BASE_URL}${API_PREFIX}/auth/register`;
  const payload = JSON.stringify({ email, password });
  const params = {
    headers: { 
      'Content-Type': 'application/json',
      'X-Loadtest': '1', // Bypass rate limiting (API Gateway expects "1", not "true")
    },
    tags: { name: 'Register' },
  };
  
  debugLog('Register request', { email, url });
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  registerLatency.add(duration);
  
  debugLog('Register response', { 
    status: res.status, 
    duration, 
    bodyPreview: res.body.substring(0, 100) 
  });
  
  // 201 = success, 409 = duplicate (expected), others = error
  const isSuccess = res.status === 201;
  const isDuplicate = res.status === 409;
  
  const success = check(res, {
    'register status 201 or 409': (r) => r.status === 201 || r.status === 409,
    'register has token (if 201)': (r) => {
      if (r.status !== 201) return true; // 409 doesn't need token
      try {
        const body = JSON.parse(r.body);
        return !!body.token;
      } catch {
        return false;
      }
    },
  });
  
  if (isSuccess) {
    registerSuccessRate.add(true);
  } else if (isDuplicate) {
    registerDuplicateRate.add(true);
    registerSuccessRate.add(true); // 409 is expected, count as success
    debugLog('Register duplicate (expected)', { email, status: res.status });
  } else {
    registerSuccessRate.add(false);
    registerErrors.add(1);
    console.error(`[Register] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  let token = null;
  if (isSuccess) {
    try {
      const body = JSON.parse(res.body);
      token = body.token;
      debugLog('Register token extracted', { tokenLength: token ? token.length : 0 });
    } catch (e) {
      debugLog('Register token extraction failed', { error: e.message });
    }
  }
  
  return { success: isSuccess || isDuplicate, token, status: res.status, isDuplicate };
}

// Helper: Login
function loginUser(email, password) {
  const url = `${BASE_URL}${API_PREFIX}/auth/login`;
  const payload = JSON.stringify({ email, password });
  const params = {
    headers: { 
      'Content-Type': 'application/json',
      'X-Loadtest': '1', // Bypass rate limiting (API Gateway expects "1", not "true")
    },
    tags: { name: 'Login' },
  };
  
  debugLog('Login request', { email, url });
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  loginLatency.add(duration);
  
  debugLog('Login response', { 
    status: res.status, 
    duration, 
    bodyPreview: res.body.substring(0, 100) 
  });
  
  const success = check(res, {
    'login status 200': (r) => r.status === 200,
    'login has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.token;
      } catch {
        return false;
      }
    },
  });
  
  loginSuccessRate.add(success);
  if (!success) {
    loginErrors.add(1);
    console.error(`[Login] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  let token = null;
  if (success) {
    try {
      const body = JSON.parse(res.body);
      token = body.token;
      debugLog('Login token extracted', { tokenLength: token ? token.length : 0 });
    } catch (e) {
      debugLog('Login token extraction failed', { error: e.message });
    }
  }
  
  return { success, token, status: res.status };
}

// Helper: Validate token
function validateToken(token, expectRevoked = false) {
  const url = `${BASE_URL}${API_PREFIX}/auth/validate`;
  const payload = JSON.stringify({});
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Loadtest': '1', // Bypass rate limiting (API Gateway expects "1", not "true")
    },
    tags: { name: 'Validate' },
  };
  
  debugLog('Validate request', { 
    tokenLength: token ? token.length : 0,
    tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
    url,
    expectRevoked,
  });
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  validateLatency.add(duration);
  
  debugLog('Validate response', { 
    status: res.status, 
    duration, 
    bodyPreview: res.body.substring(0, 100) 
  });
  
  // Check if token is revoked
  let isRevoked = false;
  try {
    const body = JSON.parse(res.body);
    if (body.error && body.error.includes('revoked')) {
      isRevoked = true;
    }
  } catch {
    // Not JSON or parse error
  }
  
  // If we expect revocation, 401 with "revoked" is success
  // Otherwise, 200 with valid=true is success
  let success;
  if (expectRevoked) {
    success = check(res, {
      'validate status 401 (revoked expected)': (r) => r.status === 401,
      'validate error is revoked': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.error && body.error.includes('revoked');
        } catch {
          return false;
        }
      },
    });
    if (success) {
      debugLog('Token correctly revoked (expected)', { email: 'N/A' });
    }
  } else {
    success = check(res, {
      'validate status 200': (r) => r.status === 200,
      'validate is valid': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.valid === true;
        } catch {
          return false;
        }
      },
    });
  }
  
  validateSuccessRate.add(success);
  if (!success) {
    if (expectRevoked && !isRevoked) {
      // Expected revocation but token is still valid - this is a problem
      console.error(`[Validate] WARNING: Token should be revoked but is still valid! Status: ${res.status}`);
      validateErrors.add(1);
    } else if (!expectRevoked && isRevoked) {
      // Unexpected revocation - this is an error
      console.error(`[Validate] Failed: Token unexpectedly revoked - ${res.status} - ${res.body.substring(0, 100)}`);
      validateErrors.add(1);
    } else {
      // Other validation failure
      console.error(`[Validate] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
      validateErrors.add(1);
    }
  }
  
  return { success, status: res.status, isRevoked };
}

// Helper: Refresh token
function refreshToken(token) {
  const url = `${BASE_URL}${API_PREFIX}/auth/refresh`;
  const payload = JSON.stringify({});
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Loadtest': '1', // Bypass rate limiting (API Gateway expects "1", not "true")
    },
    tags: { name: 'Refresh' },
  };
  
  debugLog('Refresh request', { 
    tokenLength: token ? token.length : 0,
    tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
    url,
    headers: params.headers,
  });
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  refreshLatency.add(duration);
  
  debugLog('Refresh response', { 
    status: res.status, 
    duration, 
    bodyPreview: res.body.substring(0, 200),
    headers: res.headers,
  });
  
  const success = check(res, {
    'refresh status 200': (r) => r.status === 200,
    'refresh has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.token;
      } catch {
        return false;
      }
    },
  });
  
  refreshSuccessRate.add(success);
  if (!success) {
    refreshErrors.add(1);
    console.error(`[Refresh] Failed: ${res.status} - ${res.body.substring(0, 200)}`);
    console.error(`[Refresh] Response headers:`, JSON.stringify(res.headers));
  }
  
  let newToken = null;
  if (success) {
    try {
      const body = JSON.parse(res.body);
      newToken = body.token;
      debugLog('Refresh token extracted', { 
        newTokenLength: newToken ? newToken.length : 0,
        newTokenPreview: newToken ? newToken.substring(0, 20) + '...' : 'none',
      });
    } catch (e) {
      debugLog('Refresh token extraction failed', { error: e.message, body: res.body.substring(0, 200) });
    }
  }
  
  return { success, token: newToken, status: res.status };
}

// Helper: Logout
function logoutToken(token) {
  const url = `${BASE_URL}${API_PREFIX}/auth/logout`;
  const payload = JSON.stringify({});
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Loadtest': '1', // Bypass rate limiting (API Gateway expects "1", not "true")
    },
    tags: { name: 'Logout' },
  };
  
  debugLog('Logout request', { 
    tokenLength: token ? token.length : 0,
    tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
    url 
  });
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  logoutLatency.add(duration);
  
  debugLog('Logout response', { 
    status: res.status, 
    duration, 
    bodyPreview: res.body.substring(0, 100) 
  });
  
  const success = check(res, {
    'logout status 200': (r) => r.status === 200,
    'logout response ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok === true;
      } catch {
        return false;
      }
    },
  });
  
  logoutSuccessRate.add(success);
  if (!success) {
    logoutErrors.add(1);
    console.error(`[Logout] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  return { success, status: res.status };
}

// Main test function
export default function () {
  const email = generateEmail();
  const password = 'test123456';
  
  debugLog('Test iteration start', { email });
  
  // Register
  const registerResult = registerUser(email, password);
  if (!registerResult.success && !registerResult.isDuplicate) {
    debugLog('Register failed, skipping iteration', { email, status: registerResult.status });
    sleep(1);
    return;
  }
  
  // If duplicate, try login instead
  let token = null;
  if (registerResult.isDuplicate) {
    debugLog('Register duplicate, attempting login', { email });
    const loginResult = loginUser(email, password);
    if (!loginResult.success || !loginResult.token) {
      debugLog('Login failed after duplicate register', { email });
      sleep(1);
      return;
    }
    token = loginResult.token;
  } else {
    token = registerResult.token;
  }
  
  if (!token) {
    debugLog('No token available, skipping iteration', { email });
    sleep(1);
    return;
  }
  
  debugLog('Token obtained, proceeding with auth flow', { 
    email, 
    tokenLength: token.length,
    tokenPreview: token.substring(0, 20) + '...',
  });
  
  // Small random sleep to avoid thundering herd
  sleep(Math.random() * 0.5);
  
  // Login (if we registered, login to test login endpoint)
  if (!registerResult.isDuplicate) {
    const loginResult = loginUser(email, password);
    if (loginResult.success && loginResult.token) {
      token = loginResult.token; // Use login token
      debugLog('Login successful, using login token', { email });
    }
  }
  
  // Small random sleep
  sleep(Math.random() * 0.5);
  
  // Validate token (multiple times to test connection reuse)
  for (let i = 0; i < 3; i++) {
    validateToken(token);
    sleep(Math.random() * 0.3);
  }
  
  // Refresh token
  const refreshResult = refreshToken(token);
  if (refreshResult.success && refreshResult.token) {
    debugLog('Refresh successful, validating new token', { email });
    // Validate new token (should be valid)
    validateToken(refreshResult.token, false);
    
    // Logout with new token
    const logoutResult = logoutToken(refreshResult.token);
    
    if (logoutResult.success) {
      // Try to validate revoked token (should fail - this is EXPECTED)
      // Pass expectRevoked=true so 401 "token revoked" is counted as success
      const validateAfterLogout = validateToken(refreshResult.token, true);
      if (validateAfterLogout.success) {
        debugLog('Token correctly invalidated after logout (expected behavior)', { email });
      } else {
        console.warn(`[WARNING] Token validation after logout: Expected 401 revoked, got ${validateAfterLogout.status}`);
      }
    }
  } else {
    debugLog('Refresh failed, attempting logout with original token', { email });
    // Logout with original token
    const logoutResult = logoutToken(token);
    
    if (logoutResult.success) {
      // Validate revoked token (expected to fail)
      validateToken(token, true);
    }
  }
  
  // Random sleep between iterations (1-3 seconds)
  sleep(1 + Math.random() * 2);
}

// Generate HTML report and save JSON for percentile analysis
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `test-results/k6-auth-comprehensive-${timestamp}.html`;
  const jsonPath = `test-results/k6-auth-comprehensive-${timestamp}.json`;
  
  // Save JSON for percentile analysis
  const fs = require('fs');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    console.log(`\n✅ JSON results saved to: ${jsonPath}`);
    console.log(`   Run: node scripts/load/calculate-granular-percentiles.js ${jsonPath}`);
  } catch (err) {
    console.error(`Failed to save JSON: ${err.message}`);
  }
  
  return {
    [reportPath]: htmlReport(data),
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  // Simple text summary
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    metrics: {
      register_success: data.metrics.register_success?.values?.rate || 0,
      register_duplicate: data.metrics.register_duplicate?.values?.rate || 0,
      login_success: data.metrics.login_success?.values?.rate || 0,
      validate_success: data.metrics.validate_success?.values?.rate || 0,
      refresh_success: data.metrics.refresh_success?.values?.rate || 0,
      logout_success: data.metrics.logout_success?.values?.rate || 0,
    },
  }, null, 2);
}

