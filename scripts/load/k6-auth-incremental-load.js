import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// Custom metrics
const registerSuccessRate = new Rate('register_success');
const loginSuccessRate = new Rate('login_success');
const validateSuccessRate = new Rate('validate_success');
const refreshSuccessRate = new Rate('refresh_success');

const registerLatency = new Trend('register_latency');
const loginLatency = new Trend('login_latency');
const validateLatency = new Trend('validate_latency');
const refreshLatency = new Trend('refresh_latency');

const registerErrors = new Counter('register_errors');
const loginErrors = new Counter('login_errors');
const validateErrors = new Counter('validate_errors');
const refreshErrors = new Counter('refresh_errors');

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
    'register_success': ['rate>0.95'],  // 95% success rate
    'login_success': ['rate>0.99'],     // 99% success rate
    'validate_success': ['rate>0.99'],   // 99% success rate
    'refresh_success': ['rate>0.99'],   // 99% success rate
    
    // Latency thresholds (P95 should be reasonable)
    'register_latency': ['p(95)<2000'],  // P95 < 2s
    'login_latency': ['p(95)<1000'],     // P95 < 1s
    'validate_latency': ['p(95)<500'],   // P95 < 500ms
    'refresh_latency': ['p(95)<500'],    // P95 < 500ms
    
    // HTTP errors
    'http_req_failed': ['rate<0.05'],    // < 5% HTTP errors
    'http_req_duration': ['p(95)<2000'], // P95 < 2s
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
      'X-Loadtest': 'true', // Bypass rate limiting
    },
    tags: { name: 'Register' },
  };
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  registerLatency.add(duration);
  
  const success = check(res, {
    'register status 201': (r) => r.status === 201,
    'register has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.token;
      } catch {
        return false;
      }
    },
  });
  
  registerSuccessRate.add(success);
  if (!success) {
    registerErrors.add(1);
    console.error(`[Register] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  let token = null;
  try {
    const body = JSON.parse(res.body);
    token = body.token;
  } catch {
    // Token extraction failed
  }
  
  return { success, token, status: res.status };
}

// Helper: Login
function loginUser(email, password) {
  const url = `${BASE_URL}${API_PREFIX}/auth/login`;
  const payload = JSON.stringify({ email, password });
  const params = {
    headers: { 
      'Content-Type': 'application/json',
      'X-Loadtest': 'true', // Bypass rate limiting
    },
    tags: { name: 'Login' },
  };
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  loginLatency.add(duration);
  
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
  try {
    const body = JSON.parse(res.body);
    token = body.token;
  } catch {
    // Token extraction failed
  }
  
  return { success, token, status: res.status };
}

// Helper: Validate token
function validateToken(token) {
  const url = `${BASE_URL}${API_PREFIX}/auth/validate`;
  const payload = JSON.stringify({});
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Loadtest': 'true', // Bypass rate limiting
    },
    tags: { name: 'Validate' },
  };
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  validateLatency.add(duration);
  
  const success = check(res, {
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
  
  validateSuccessRate.add(success);
  if (!success) {
    validateErrors.add(1);
    console.error(`[Validate] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  return { success, status: res.status };
}

// Helper: Refresh token
function refreshToken(token) {
  const url = `${BASE_URL}${API_PREFIX}/auth/refresh`;
  const payload = JSON.stringify({});
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Loadtest': 'true', // Bypass rate limiting
    },
    tags: { name: 'Refresh' },
  };
  
  const startTime = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - startTime;
  
  refreshLatency.add(duration);
  
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
    console.error(`[Refresh] Failed: ${res.status} - ${res.body.substring(0, 100)}`);
  }
  
  let newToken = null;
  try {
    const body = JSON.parse(res.body);
    newToken = body.token;
  } catch {
    // Token extraction failed
  }
  
  return { success, token: newToken, status: res.status };
}

// Main test function
export default function () {
  const email = generateEmail();
  const password = 'test123456';
  
  // Register
  const registerResult = registerUser(email, password);
  if (!registerResult.success) {
    sleep(1); // Wait before retry
    return;
  }
  
  // Small random sleep to avoid thundering herd
  sleep(Math.random() * 0.5);
  
  // Login
  const loginResult = loginUser(email, password);
  if (!loginResult.success || !loginResult.token) {
    sleep(1);
    return;
  }
  
  const token = loginResult.token;
  
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
    // Validate new token
    validateToken(refreshResult.token);
  }
  
  // Random sleep between iterations (1-3 seconds)
  sleep(1 + Math.random() * 2);
}

// Generate HTML report
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `test-results/k6-incremental-load-${timestamp}.html`;
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
      login_success: data.metrics.login_success?.values?.rate || 0,
      validate_success: data.metrics.validate_success?.values?.rate || 0,
      refresh_success: data.metrics.refresh_success?.values?.rate || 0,
    },
  }, null, 2);
}

