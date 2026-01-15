/**
 * k6 Incremental Limit Finder for CA/Leaf Certificate Rotation
 * 
 * This script incrementally increases load (HTTP/2 and HTTP/3) during certificate rotation
 * to find the maximum sustainable throughput with zero downtime.
 * 
 * Strategy:
 * - Start with baseline (H2=80 req/s, H3=40 req/s)
 * - Each iteration increases by 10 req/s for H2 and 5 req/s for H3
 * - Continues until error rate > 0% or dropped iterations > 1%
 * - Past performance: 460 req/s combined (280 H2 + 180 H3)
 * 
 * Usage:
 *   # Run with default baseline
 *   k6 run scripts/load/k6-find-ca-rotation-limit.js
 *   
 *   # Start from specific rates
 *   H2_START_RATE=100 H3_START_RATE=50 k6 run scripts/load/k6-find-ca-rotation-limit.js
 *   
 *   # Custom increment steps
 *   H2_INCREMENT=20 H3_INCREMENT=10 k6 run scripts/load/k6-find-ca-rotation-limit.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Metrics
const h2_latency = new Trend('h2_latency');
const h3_latency = new Trend('h3_latency');
const h2_fail = new Rate('h2_fail');
const h3_fail = new Rate('h3_fail');
const h2_total = new Counter('h2_total');
const h3_total = new Counter('h3_total');

// Configuration
const HOST = __ENV.HOST || 'record.local';
const BASE_URL = __ENV.BASE_URL || 'https://caddy-h3.ingress-nginx.svc.cluster.local:443';
const ENDPOINT = __ENV.ENDPOINT || '/_caddy/healthz';
const URL = `${BASE_URL}${ENDPOINT}`;

// Incremental limit finding configuration
const H2_START_RATE = Number(__ENV.H2_START_RATE || 80);   // Start at 80 req/s
const H3_START_RATE = Number(__ENV.H3_START_RATE || 40);    // Start at 40 req/s
const H2_INCREMENT = Number(__ENV.H2_INCREMENT || 10);      // Increase by 10 req/s each iteration
const H3_INCREMENT = Number(__ENV.H3_INCREMENT || 5);       // Increase by 5 req/s each iteration
const H2_MAX_RATE = Number(__ENV.H2_MAX_RATE || 300);       // Max 300 req/s for H2
const H3_MAX_RATE = Number(__ENV.H3_MAX_RATE || 200);       // Max 200 req/s for H3
const DURATION = __ENV.DURATION || '180s';                  // 3 minutes per iteration
const MAX_ITERATIONS = Number(__ENV.MAX_ITERATIONS || 20);   // Max 20 iterations

// Current iteration rates (set by setup)
let current_h2_rate = H2_START_RATE;
let current_h3_rate = H3_START_RATE;
let iteration = 0;

// VU allocation (scale with rate)
const H2_PRE_VUS = Number(__ENV.H2_PRE_VUS || 20);
const H2_MAX_VUS = Number(__ENV.H2_MAX_VUS || 160);
const H3_PRE_VUS = Number(__ENV.H3_PRE_VUS || 10);
const H3_MAX_VUS = Number(__ENV.H3_MAX_VUS || 100);

export const options = {
  // Strict TLS verification (production-grade)
  insecureSkipTLSVerify: false,
  scenarios: {
    h2: {
      executor: 'constant-arrival-rate',
      rate: current_h2_rate,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: H2_PRE_VUS,
      maxVUs: H2_MAX_VUS,
      exec: 'h2_request',
    },
    h3: {
      executor: 'constant-arrival-rate',
      rate: current_h3_rate,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: H3_PRE_VUS,
      maxVUs: H3_MAX_VUS,
      exec: 'h3_request',
    },
  },
  thresholds: {
    // Zero-downtime requirements: 0% error rate, minimal drops
    'h2_fail': ['rate==0'],  // Zero failures for H2
    'h3_fail': ['rate==0'],  // Zero failures for H3
    'h2_latency': ['p(99)<500'],  // 99% of H2 requests < 500ms
    'h3_latency': ['p(99)<800'],  // 99% of H3 requests < 800ms
    'dropped_iterations': ['rate<0.01'],  // Less than 1% dropped iterations
  },
};

// HTTP/2 request
export function h2_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: '10s',  // Increased to handle rotation overhead
    httpVersion: 'HTTP/2',
    noConnectionReuse: false,
  });

  h2_latency.add(res.timings.duration);
  h2_fail.add(res.status !== 200);
  h2_total.add(1);
  check(res, { 'H2 status 200': (r) => r.status === 200 });

  sleep(Math.random() * 0.01);
}

// HTTP/3 request
export function h3_request() {
  const res = http.get(URL, {
    headers: { Host: HOST },
    timeout: '10s',  // Increased to handle rotation overhead
    httpVersion: 'HTTP/3',
    noConnectionReuse: false,
  });

  h3_latency.add(res.timings.duration);
  h3_fail.add(res.status !== 200);
  h3_total.add(1);
  check(res, { 'H3 status 200': (r) => r.status === 200 });

  sleep(Math.random() * 0.015);
}

// Summary handler - reports results and determines if limit found
export function handleSummary(data) {
  const h2_fail_rate = data.metrics.h2_fail?.values?.rate || 0;
  const h3_fail_rate = data.metrics.h3_fail?.values?.rate || 0;
  const dropped_rate = data.metrics.dropped_iterations?.values?.rate || 0;
  const h2_total_reqs = data.metrics.h2_total?.values?.count || 0;
  const h3_total_reqs = data.metrics.h3_total?.values?.count || 0;
  const total_reqs = h2_total_reqs + h3_total_reqs;
  const combined_rate = current_h2_rate + current_h3_rate;

  const summary = {
    iteration: iteration,
    timestamp: new Date().toISOString(),
    rates: {
      h2: current_h2_rate,
      h3: current_h3_rate,
      combined: combined_rate,
    },
    results: {
      h2_total: h2_total_reqs,
      h3_total: h3_total_reqs,
      total: total_reqs,
      h2_fail_rate: h2_fail_rate,
      h3_fail_rate: h3_fail_rate,
      dropped_rate: dropped_rate,
    },
    latency: {
      h2_p50: data.metrics.h2_latency?.values?.['p(50)'] || 0,
      h2_p95: data.metrics.h2_latency?.values?.['p(95)'] || 0,
      h2_p99: data.metrics.h2_latency?.values?.['p(99)'] || 0,
      h3_p50: data.metrics.h3_latency?.values?.['p(50)'] || 0,
      h3_p95: data.metrics.h3_latency?.values?.['p(95)'] || 0,
      h3_p99: data.metrics.h3_latency?.values?.['p(99)'] || 0,
    },
    limit_found: (h2_fail_rate > 0 || h3_fail_rate > 0 || dropped_rate > 0.01),
    next_iteration: {
      h2_rate: Math.min(current_h2_rate + H2_INCREMENT, H2_MAX_RATE),
      h3_rate: Math.min(current_h3_rate + H3_INCREMENT, H3_MAX_RATE),
    },
  };

  // Print summary to console
  console.log('\n=== CA Rotation Limit Finding - Iteration ' + iteration + ' ===');
  console.log(JSON.stringify(summary, null, 2));

  // Determine if limit found
  if (summary.limit_found) {
    console.log('\n⚠️  LIMIT FOUND: Error rate or dropped iterations exceeded threshold');
    console.log(`   H2 Rate: ${current_h2_rate} req/s (fail rate: ${(h2_fail_rate * 100).toFixed(2)}%)`);
    console.log(`   H3 Rate: ${current_h3_rate} req/s (fail rate: ${(h3_fail_rate * 100).toFixed(2)}%)`);
    console.log(`   Dropped: ${(dropped_rate * 100).toFixed(2)}%`);
    console.log(`   Previous successful rate: H2=${current_h2_rate - H2_INCREMENT} req/s, H3=${current_h3_rate - H3_INCREMENT} req/s`);
  } else {
    console.log('\n✅ Iteration passed: No errors, proceeding to next iteration');
    console.log(`   Next rates: H2=${summary.next_iteration.h2_rate} req/s, H3=${summary.next_iteration.h3_rate} req/s`);
  }

  return {
    'stdout': JSON.stringify(summary, null, 2),
  };
}
