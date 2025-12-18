import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// -------- Configuration --------
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const HOST = __ENV.HOST || 'record.local';
const ENDPOINT = __ENV.ENDPOINT || '/_caddy/healthz';
const DURATION = __ENV.DURATION || '180s';  // 3 minutes to cover rotation
const VUS = Number(__ENV.VUS || 30);  // Virtual users (concurrent requests)
const RATE = Number(__ENV.RATE || 0);  // Target rate (0 = unlimited, use VUS)
const TIMEOUT = __ENV.TIMEOUT || '3s';

// Metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

// -------- Options --------
export const options = {
  // Use VUS (virtual users) for concurrent load
  vus: VUS,
  duration: DURATION,
  
  // Thresholds - strict for zero-downtime testing
  thresholds: {
    'http_req_duration': [
      'p(50)<50',      // 50% of requests < 50ms
      'p(95)<200',     // 95% of requests < 200ms
      'p(99)<500',     // 99% of requests < 500ms
      'p(99.9)<1000',  // 99.9% of requests < 1s
      'p(100)<3000'    // 100% of requests < 3s (timeout)
    ],
    'http_req_failed': ['rate<0.01'],  // Less than 1% failures
    'errors': ['rate<0.01'],
  },
  
  // If RATE is set, use constant rate instead of VUS
  ...(RATE > 0 ? {
    scenarios: {
      constant_rate: {
        executor: 'constant-arrival-rate',
        rate: RATE,
        timeUnit: '1s',
        duration: DURATION,
        preAllocatedVUs: VUS,
        maxVUs: VUS * 2,
      },
    },
  } : {}),
};

// -------- Main Function --------
export default function () {
  const url = `${BASE_URL}${ENDPOINT}`;
  const params = {
    headers: {
      'Host': HOST,
    },
    tags: {
      name: 'caddy_health',
    },
    timeout: TIMEOUT,
  };

  // Make request
  const response = http.get(url, params);
  
  // Check response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 3s': (r) => r.timings.duration < 3000,
  });

  // Track metrics
  if (!success) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }
  responseTime.add(response.timings.duration);

  // Small sleep to avoid overwhelming (if using VUS mode)
  if (RATE === 0) {
    sleep(0.1);  // 100ms between requests per VU
  }
}

// -------- Summary --------
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      http_req_duration: {
        avg: data.metrics.http_req_duration.values.avg,
        min: data.metrics.http_req_duration.values.min,
        max: data.metrics.http_req_duration.values.max,
        p50: data.metrics.http_req_duration.values['p(50)'],
        p95: data.metrics.http_req_duration.values['p(95)'],
        p99: data.metrics.http_req_duration.values['p(99)'],
        p999: data.metrics.http_req_duration.values['p(99.9)'],
      },
      http_req_total: data.metrics.http_reqs.values.count,
      http_req_failed: data.metrics.http_req_failed.values.rate,
      errors: data.metrics.errors.values.rate,
    },
  };
  
  // Print summary to console (will be captured in logs)
  console.log('\n=== CA Rotation Load Test Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  
  return {
    'stdout': JSON.stringify(summary, null, 2),
  };
}

