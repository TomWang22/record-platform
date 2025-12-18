/**
 * k6 Pipeline Load Test with Comprehensive Tail Latency Metrics
 * 
 * Tests the full pipeline (webapp -> API gateway -> analytics service) with
 * detailed percentile tracking similar to pgbench:
 * - p50, p95, p99, p999, p9999, p99999, p999999, p9999999, p100
 * - Tests under various load patterns
 * - Validates pipeline end-to-end
 * 
 * Usage:
 *   # Basic load test
 *   k6 run --vus 50 --duration 5m scripts/load/k6-pipeline-tail-latency.js
 * 
 *   # High load with detailed metrics
 *   BASE_URL=http://localhost:8080 k6 run --vus 200 --duration 10m scripts/load/k6-pipeline-tail-latency.js
 * 
 *   # Soak test
 *   k6 run --stages 0s:10,30s:50,2m:100,10m:100,12m:50,15m:0 scripts/load/k6-pipeline-tail-latency.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const ANALYTICS_URL = __ENV.ANALYTICS_URL || `${BASE_URL}/api/analytics`;
const AI_URL = __ENV.AI_URL || `${BASE_URL}/api/ai`;
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '5m';
const MODE = (__ENV.MODE || 'mixed').toLowerCase(); // mixed, read-heavy, write-heavy

// Custom metrics for detailed latency tracking
const pipelineLatency = new Trend('pipeline_latency_ms', true); // Full pipeline latency
const analyticsLatency = new Trend('analytics_latency_ms', true);
const aiLatency = new Trend('ai_latency_ms', true);
const gatewayLatency = new Trend('gateway_latency_ms', true);
const dbQueryLatency = new Trend('db_query_latency_ms', true);

// Success/failure tracking
const pipelineSuccess = new Rate('pipeline_success');
const analyticsSuccess = new Rate('analytics_success');
const aiSuccess = new Rate('ai_success');

// Throughput tracking
const requestsPerSecond = new Counter('requests_per_second');

// Real-world test queries
const TEST_QUERIES = [
  'The Beatles Abbey Road',
  'Pink Floyd Dark Side of the Moon',
  'Led Zeppelin IV',
  'The Rolling Stones Sticky Fingers',
  'Queen A Night at the Opera',
  'David Bowie Ziggy Stardust',
  'Fleetwood Mac Rumours',
  'The Who Who\'s Next',
  'Radiohead OK Computer',
  'Nirvana Nevermind',
  'The Doors L.A. Woman',
  'Jimi Hendrix Are You Experienced',
  'Bob Dylan Highway 61 Revisited',
  'The Clash London Calling',
  'The Velvet Underground & Nico',
];

function getRandomQuery() {
  return TEST_QUERIES[Math.floor(Math.random() * TEST_QUERIES.length)];
}

// Test analytics service endpoints
function testAnalyticsService(query) {
  const startTime = Date.now();
  
  // Test 1: Price trend (read-heavy)
  const trendStart = Date.now();
  const trendRes = http.get(`${ANALYTICS_URL}/price-trend`, {
    params: {
      artist: query.split(' ')[0],
      name: query.split(' ').slice(1).join(' '),
      days: 90,
    },
    tags: { name: 'analytics_price_trend', type: 'read' },
  });
  const trendLatency = Date.now() - trendStart;
  analyticsLatency.add(trendLatency);
  
  const trendOk = check(trendRes, {
    'price trend status 200 or 400': (r) => r.status === 200 || r.status === 400,
    'price trend response time < 2s': (r) => r.timings.duration < 2000,
  });
  
  sleep(0.1);
  
  // Test 2: Fuzzy search (read-heavy, complex)
  const fuzzyStart = Date.now();
  const fuzzyRes = http.get(`${ANALYTICS_URL}/fuzzy-search`, {
    params: {
      q: query,
      limit: 20,
    },
    tags: { name: 'analytics_fuzzy_search', type: 'read' },
  });
  const fuzzyLatency = Date.now() - fuzzyStart;
  analyticsLatency.add(fuzzyLatency);
  
  const fuzzyOk = check(fuzzyRes, {
    'fuzzy search status 200 or 400': (r) => r.status === 200 || r.status === 400,
    'fuzzy search response time < 3s': (r) => r.timings.duration < 3000,
  });
  
  sleep(0.1);
  
  // Test 3: Predict price (write-heavy, uses worker threads)
  const predictStart = Date.now();
  const predictRes = http.post(
    `${ANALYTICS_URL}/predict-price`,
    JSON.stringify({
      items: [{
        query: query,
        base_price: 50 + Math.random() * 150,
        record_grade: 'Very Good',
      }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'analytics_predict_price', type: 'write' },
    }
  );
  const predictLatency = Date.now() - predictStart;
  analyticsLatency.add(predictLatency);
  
  const predictOk = check(predictRes, {
    'predict price status 200': (r) => r.status === 200,
    'predict price response time < 5s': (r) => r.timings.duration < 5000,
    'predict price has valid result': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.suggested !== undefined && body.suggested > 0;
      } catch {
        return false;
      }
    },
  });
  
  const totalLatency = Date.now() - startTime;
  const success = trendOk && fuzzyOk && predictOk;
  
  analyticsSuccess.add(success ? 1 : 0);
  return { success, latency: totalLatency };
}

// Test Python AI service endpoints
function testAIService(query) {
  const startTime = Date.now();
  
  // Test AI price prediction
  const aiStart = Date.now();
  const aiRes = http.post(
    `${AI_URL}/predict-price`,
    JSON.stringify({
      query: query,
      base_price: 50 + Math.random() * 150,
      record_grade: 'Very Good',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'ai_predict_price', type: 'write' },
    }
  );
  const aiLatency = Date.now() - aiStart;
  aiLatency.add(aiLatency);
  
  const aiOk = check(aiRes, {
    'AI predict status 200': (r) => r.status === 200,
    'AI predict response time < 10s': (r) => r.timings.duration < 10000,
  });
  
  const totalLatency = Date.now() - startTime;
  aiSuccess.add(aiOk ? 1 : 0);
  
  return { success: aiOk, latency: totalLatency };
}

// Test full pipeline (webapp -> gateway -> analytics -> AI)
function testFullPipeline(query) {
  const pipelineStart = Date.now();
  
  // Step 1: Health check through gateway
  const healthStart = Date.now();
  const healthRes = http.get(`${BASE_URL}/healthz`, {
    tags: { name: 'gateway_health', type: 'read' },
  });
  const gatewayLat = Date.now() - healthStart;
  gatewayLatency.add(gatewayLat);
  
  check(healthRes, {
    'gateway health status 200': (r) => r.status === 200,
  });
  
  sleep(0.1);
  
  // Step 2: Test analytics service
  const analyticsResult = testAnalyticsService(query);
  
  sleep(0.2);
  
  // Step 3: Test AI service (if enabled)
  let aiResult = { success: true, latency: 0 };
  if (MODE !== 'read-heavy') {
    aiResult = testAIService(query);
  }
  
  const totalPipelineLatency = Date.now() - pipelineStart;
  pipelineLatency.add(totalPipelineLatency);
  
  const isPipelineSuccess = analyticsResult.success && aiResult.success;
  pipelineSuccess.add(isPipelineSuccess ? 1 : 0);
  
  requestsPerSecond.add(1);
  
  return { success: isPipelineSuccess, latency: totalPipelineLatency };
}

export const options = {
  stages: [
    { duration: '10s', target: Math.min(VUS, 10) }, // Warm-up
    { duration: DURATION, target: VUS }, // Main load
    { duration: '10s', target: 0 }, // Cool-down
  ],
  thresholds: {
    // Comprehensive percentile thresholds for tail latency analysis
    'http_req_duration': [
      'p(50)<200',      // Median
      'p(95)<1000',     // 95th percentile
      'p(99)<2000',     // 99th percentile
      'p(99.9)<5000',   // 99.9th percentile
      'p(99.99)<10000', // 99.99th percentile
      'p(99.999)<20000', // 99.999th percentile
      'p(99.9999)<50000', // 99.9999th percentile
      'p(99.99999)<100000', // 99.99999th percentile
      'p(100)<200000',  // Max
    ],
    'http_req_failed': ['rate<0.05'], // Less than 5% failure rate
    'pipeline_success': ['rate>0.90'], // 90% pipeline success
    'analytics_success': ['rate>0.85'], // 85% analytics success
    'ai_success': ['rate>0.80'], // 80% AI success (more lenient due to complexity)
  },
};

export default function () {
  const query = getRandomQuery();
  
  // Run full pipeline test
  const result = testFullPipeline(query);
  
  // Add small random sleep to avoid thundering herd
  sleep(0.5 + Math.random() * 1.0);
}

// Calculate detailed percentiles from custom metrics
function calculatePercentiles(values) {
  if (!values || values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    p50: sorted[Math.floor(len * 0.50)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    p999: sorted[Math.floor(len * 0.999)],
    p9999: sorted[Math.floor(len * 0.9999)],
    p99999: sorted[Math.floor(len * 0.99999)],
    p999999: sorted[Math.floor(len * 0.999999)],
    p9999999: sorted[Math.floor(len * 0.9999999)],
    p100: sorted[len - 1],
    min: sorted[0],
    max: sorted[len - 1],
    avg: values.reduce((a, b) => a + b, 0) / len,
    median: sorted[Math.floor(len * 0.5)],
  };
}

export function handleSummary(data) {
  // Extract built-in HTTP percentiles
  const httpPercentiles = data.metrics.http_req_duration?.values || {};
  
  // Build comprehensive latency report
  const report = {
    timestamp: new Date().toISOString(),
    test_config: {
      base_url: BASE_URL,
      analytics_url: ANALYTICS_URL,
      ai_url: AI_URL,
      virtual_users: VUS,
      duration: DURATION,
      mode: MODE,
    },
    http_metrics: {
      total_requests: data.metrics.http_reqs?.values?.count || 0,
      failed_requests: ((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2) + '%',
      throughput: (data.metrics.http_reqs?.values?.rate || 0).toFixed(2) + ' req/s',
      percentiles: {
        p50: httpPercentiles['p(50)']?.toFixed(2) || 'N/A',
        p95: httpPercentiles['p(95)']?.toFixed(2) || 'N/A',
        p99: httpPercentiles['p(99)']?.toFixed(2) || 'N/A',
        p999: httpPercentiles['p(99.9)']?.toFixed(2) || 'N/A',
        p9999: httpPercentiles['p(99.99)']?.toFixed(2) || 'N/A',
        p99999: httpPercentiles['p(99.999)']?.toFixed(2) || 'N/A',
        p999999: httpPercentiles['p(99.9999)']?.toFixed(2) || 'N/A',
        p9999999: httpPercentiles['p(99.99999)']?.toFixed(2) || 'N/A',
        p100: httpPercentiles.max?.toFixed(2) || 'N/A',
        min: httpPercentiles.min?.toFixed(2) || 'N/A',
        max: httpPercentiles.max?.toFixed(2) || 'N/A',
        avg: httpPercentiles.avg?.toFixed(2) || 'N/A',
        median: httpPercentiles.med?.toFixed(2) || 'N/A',
      },
    },
    custom_metrics: {
      pipeline_latency: {
        avg: (data.metrics.pipeline_latency_ms?.values?.avg || 0).toFixed(2) + 'ms',
        min: (data.metrics.pipeline_latency_ms?.values?.min || 0).toFixed(2) + 'ms',
        max: (data.metrics.pipeline_latency_ms?.values?.max || 0).toFixed(2) + 'ms',
        p50: (data.metrics.pipeline_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.pipeline_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.pipeline_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
        p999: (data.metrics.pipeline_latency_ms?.values?.['p(99.9)'] || 0).toFixed(2) + 'ms',
        p100: (data.metrics.pipeline_latency_ms?.values?.max || 0).toFixed(2) + 'ms',
      },
      analytics_latency: {
        avg: (data.metrics.analytics_latency_ms?.values?.avg || 0).toFixed(2) + 'ms',
        p50: (data.metrics.analytics_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.analytics_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.analytics_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
        p999: (data.metrics.analytics_latency_ms?.values?.['p(99.9)'] || 0).toFixed(2) + 'ms',
        p100: (data.metrics.analytics_latency_ms?.values?.max || 0).toFixed(2) + 'ms',
      },
      ai_latency: {
        avg: (data.metrics.ai_latency_ms?.values?.avg || 0).toFixed(2) + 'ms',
        p50: (data.metrics.ai_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.ai_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.ai_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
        p999: (data.metrics.ai_latency_ms?.values?.['p(99.9)'] || 0).toFixed(2) + 'ms',
        p100: (data.metrics.ai_latency_ms?.values?.max || 0).toFixed(2) + 'ms',
      },
      gateway_latency: {
        avg: (data.metrics.gateway_latency_ms?.values?.avg || 0).toFixed(2) + 'ms',
        p50: (data.metrics.gateway_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.gateway_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.gateway_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
        p100: (data.metrics.gateway_latency_ms?.values?.max || 0).toFixed(2) + 'ms',
      },
    },
    success_rates: {
      pipeline: ((data.metrics.pipeline_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      analytics: ((data.metrics.analytics_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      ai: ((data.metrics.ai_success?.values?.rate || 0) * 100).toFixed(2) + '%',
    },
  };
  
  // Build human-readable summary
  const summary = `
📊 Pipeline Tail Latency Test Results (pgbench-style)
=====================================================

Test Configuration:
  Base URL: ${BASE_URL}
  Analytics URL: ${ANALYTICS_URL}
  AI URL: ${AI_URL}
  Virtual Users: ${VUS}
  Duration: ${DURATION}
  Mode: ${MODE}

HTTP Request Latency Percentiles (ms):
  p50   (median):     ${report.http_metrics.percentiles.p50}
  p95   (95th):       ${report.http_metrics.percentiles.p95}
  p99   (99th):       ${report.http_metrics.percentiles.p99}
  p999  (99.9th):     ${report.http_metrics.percentiles.p999}
  p9999 (99.99th):    ${report.http_metrics.percentiles.p9999}
  p99999 (99.999th):  ${report.http_metrics.percentiles.p99999}
  p999999 (99.9999th): ${report.http_metrics.percentiles.p999999}
  p9999999 (99.99999th): ${report.http_metrics.percentiles.p9999999}
  p100  (max):        ${report.http_metrics.percentiles.p100}
  
  Min:   ${report.http_metrics.percentiles.min}
  Avg:   ${report.http_metrics.percentiles.avg}
  Max:   ${report.http_metrics.percentiles.max}

Pipeline Latency (Full End-to-End):
  Avg: ${report.custom_metrics.pipeline_latency.avg}
  p50: ${report.custom_metrics.pipeline_latency.p50}
  p95: ${report.custom_metrics.pipeline_latency.p95}
  p99: ${report.custom_metrics.pipeline_latency.p99}
  p999: ${report.custom_metrics.pipeline_latency.p999}
  p100: ${report.custom_metrics.pipeline_latency.p100}

Analytics Service Latency:
  Avg: ${report.custom_metrics.analytics_latency.avg}
  p50: ${report.custom_metrics.analytics_latency.p50}
  p95: ${report.custom_metrics.analytics_latency.p95}
  p99: ${report.custom_metrics.analytics_latency.p99}
  p999: ${report.custom_metrics.analytics_latency.p999}
  p100: ${report.custom_metrics.analytics_latency.p100}

AI Service Latency:
  Avg: ${report.custom_metrics.ai_latency.avg}
  p50: ${report.custom_metrics.ai_latency.p50}
  p95: ${report.custom_metrics.ai_latency.p95}
  p99: ${report.custom_metrics.ai_latency.p99}
  p999: ${report.custom_metrics.ai_latency.p999}
  p100: ${report.custom_metrics.ai_latency.p100}

Gateway Latency:
  Avg: ${report.custom_metrics.gateway_latency.avg}
  p50: ${report.custom_metrics.gateway_latency.p50}
  p95: ${report.custom_metrics.gateway_latency.p95}
  p99: ${report.custom_metrics.gateway_latency.p99}
  p100: ${report.custom_metrics.gateway_latency.p100}

Success Rates:
  Pipeline: ${report.success_rates.pipeline}
  Analytics: ${report.success_rates.analytics}
  AI: ${report.success_rates.ai}

Overall:
  Total Requests: ${report.http_metrics.total_requests}
  Failed Requests: ${report.http_metrics.failed_requests}
  Throughput: ${report.http_metrics.throughput}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 && 
         (data.metrics.pipeline_success?.values?.rate || 0) > 0.90 ? '✅ PASS' : '⚠️  DEGRADED'}
  `;
  
  return {
    'stdout': summary,
    'summary.json': JSON.stringify(report, null, 2),
    'summary.txt': textSummary(data, { indent: ' ', enableColors: true }),
  };
}

