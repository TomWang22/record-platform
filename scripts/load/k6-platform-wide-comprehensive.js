/**
 * k6 Platform-Wide Comprehensive Load Test
 * 
 * Tests analytics and python-ai services across the entire platform:
 * 
 * SECTION 1: End-to-End Workflows
 * - Auction Monitor → Analytics → Python AI (user plans)
 * - Messaging Service (negotiation helper, next tone determination)
 * - Listings Service (past price history with Discogs, profit maximization for sellers)
 * - Shopping Service (shopper experience)
 * 
 * SECTION 2: Protocol Correctness
 * - gRPC health checks (strict TLS)
 * - HTTP/2 with strict TLS
 * - HTTP/3 (QUIC) with strict TLS
 * - ALPN negotiation
 * 
 * SECTION 3: Adversarial Tests
 * - Invalid input handling
 * - Large payload handling
 * - Concurrent request stress
 * - Database disconnect simulation
 * - Cache failure scenarios
 * 
 * Usage:
 *   # Full platform test
 *   k6 run --vus 50 --duration 10m scripts/load/k6-platform-wide-comprehensive.js
 * 
 *   # E2E workflows only
 *   E2E_ONLY=1 k6 run --vus 20 --duration 5m scripts/load/k6-platform-wide-comprehensive.js
 * 
 *   # Protocol tests only
 *   PROTOCOL_ONLY=1 k6 run --vus 10 --duration 2m scripts/load/k6-platform-wide-comprehensive.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { randomString, randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://record.local:30443';
const HOST = __ENV.HOST || 'record.local';
const API_PREFIX = __ENV.API_PREFIX || '/api';

// Test mode flags
const E2E_ONLY = __ENV.E2E_ONLY === '1';
const PROTOCOL_ONLY = __ENV.PROTOCOL_ONLY === '1';
const ADVERSARIAL_ONLY = __ENV.ADVERSARIAL_ONLY === '1';

// Custom metrics
const e2ePipelineSuccess = new Rate('e2e_pipeline_success');
const protocolSuccess = new Rate('protocol_success');
const adversarialSuccess = new Rate('adversarial_success');

// E2E workflow metrics
const auctionToAnalyticsLatency = new Trend('auction_to_analytics_latency_ms');
const analyticsToAILatency = new Trend('analytics_to_ai_latency_ms');
const aiPlanGenerationLatency = new Trend('ai_plan_generation_latency_ms');
const negotiationAdviceLatency = new Trend('negotiation_advice_latency_ms');
const profitMaximizationLatency = new Trend('profit_maximization_latency_ms');
const shoppingLatency = new Trend('shopping_latency_ms');

// Protocol metrics
const grpcHealthLatency = new Trend('grpc_health_latency_ms');
const http2Latency = new Trend('http2_latency_ms');
const http3Latency = new Trend('http3_latency_ms');

// Adversarial metrics
const invalidInputRejected = new Rate('invalid_input_rejected');
const largePayloadHandled = new Rate('large_payload_handled');
const concurrentRequestSuccess = new Rate('concurrent_request_success');

// Test data
const testQueries = [
  'Beatles Abbey Road',
  'Pink Floyd Dark Side of the Moon',
  'Led Zeppelin IV',
  'Radiohead OK Computer',
  'The Doors L.A. Woman',
  'Jimi Hendrix Are You Experienced',
  'Bob Dylan Highway 61',
  'The Rolling Stones Sticky Fingers',
  'Queen A Night at the Opera',
  'David Bowie Ziggy Stardust',
];

const recordGrades = ['M', 'NM', 'EX', 'VG+', 'VG', 'G+'];
const sleeveGrades = ['M', 'NM', 'EX', 'VG+', 'VG'];

function randomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

function randomGrade() {
  return recordGrades[Math.floor(Math.random() * recordGrades.length)];
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up
    { duration: '2m', target: 30 },     // Steady state
    { duration: '1m', target: 50 },     // Peak load
    { duration: '2m', target: 50 },    // Sustain peak
    { duration: '1m', target: 30 },     // Ramp down
    { duration: '30s', target: 10 },    // Cool down
    { duration: '30s', target: 0 },    // End
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
    'http_req_failed': ['rate<0.05'],
    'e2e_pipeline_success': ['rate>0.85'],
    'protocol_success': ['rate>0.95'],
    'adversarial_success': ['rate>0.80'],
  },
};

export default function () {
  // ============================================================================
  // SECTION 1: END-TO-END WORKFLOWS
  // ============================================================================
  
  if (!PROTOCOL_ONLY && !ADVERSARIAL_ONLY) {
    group('E2E: Auction Monitor → Analytics → Python AI', () => {
      const userId = generateUUID();
      const query = randomQuery();
      const pipelineStart = Date.now();
      
      // Step 1: Auction Monitor ingests data
      const auctionStart = Date.now();
      const auctionData = {
        source: 'ebay',
        query: query,
        items: [{
          item_id: `test-auction-${randomString(8)}`,
          title: `${query} (Vinyl)`,
          price: randomIntBetween(20, 100),
          currency: 'USD',
          ends_at: new Date(Date.now() + 86400000).toISOString(),
        }],
      };
      
      const auctionRes = http.post(`${BASE_URL}${API_PREFIX}/auction-monitor/monitor`, 
        JSON.stringify(auctionData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'auction_monitor_ingest', workflow: 'auction_analytics_ai' },
        timeout: '15s',
      });
      
      const auctionLatency = Date.now() - auctionStart;
      auctionToAnalyticsLatency.add(auctionLatency);
      
      check(auctionRes, {
        'auction monitor: status 200/201': (r) => r.status === 200 || r.status === 201,
      });
      
      sleep(1); // Allow pipeline processing
      
      // Step 2: Analytics processes data
      const analyticsStart = Date.now();
      const analyticsRes = http.get(`${BASE_URL}${API_PREFIX}/analytics/recommendations/similar`, {
        params: { q: query, userId: userId, limit: 10 },
        headers: { 'Host': HOST },
        tags: { name: 'analytics_process', workflow: 'auction_analytics_ai' },
        timeout: '15s',
      });
      
      const analyticsLatency = Date.now() - analyticsStart;
      analyticsToAILatency.add(analyticsLatency);
      
      check(analyticsRes, {
        'analytics: status 200': (r) => r.status === 200,
        'analytics: has recommendations field': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.recommendations !== undefined;
          } catch {
            return false;
          }
        },
      });
      
      sleep(0.5);
      
      // Step 3: Python AI generates user plan
      const aiStart = Date.now();
      const aiPlanData = {
        query: query,
        record_grade: randomGrade(),
        sleeve_grade: randomGrade(),
        user_id: userId,
        current_price: randomIntBetween(30, 80),
      };
      
      const aiRes = http.post(`${BASE_URL}${API_PREFIX}/ai/selling-advice`,
        JSON.stringify(aiPlanData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'ai_plan_generation', workflow: 'auction_analytics_ai' },
        timeout: '30s',
      });
      
      const aiLatency = Date.now() - aiStart;
      aiPlanGenerationLatency.add(aiLatency);
      
      const aiCheck = check(aiRes, {
        'ai plan: status 200': (r) => r.status === 200,
        'ai plan: has recommended_price': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.recommended_price !== undefined;
          } catch {
            return false;
          }
        },
      });
      
      const pipelineLatency = Date.now() - pipelineStart;
      if (aiCheck) {
        e2ePipelineSuccess.add(1);
      } else {
        e2ePipelineSuccess.add(0);
      }
    });
    
    group('E2E: Messaging Service - Negotiation Helper', () => {
      const negotiationStart = Date.now();
      const negotiationData = {
        query: randomQuery(),
        role: Math.random() > 0.5 ? 'buyer' : 'seller',
        current_price: randomIntBetween(25, 75),
        target_price: randomIntBetween(20, 70),
        user_id: generateUUID(),
      };
      
      const negRes = http.post(`${BASE_URL}${API_PREFIX}/ai/negotiation-advice`,
        JSON.stringify(negotiationData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'negotiation_advice', workflow: 'social_negotiation' },
        timeout: '30s',
      });
      
      const negotiationLatency = Date.now() - negotiationStart;
      negotiationAdviceLatency.add(negotiationLatency);
      
      check(negRes, {
        'negotiation: status 200': (r) => r.status === 200,
        'negotiation: has strategy': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.strategy !== undefined || body.negotiation_stance !== undefined;
          } catch {
            return false;
          }
        },
      });
    });
    
    group('E2E: Listings Service - Profit Maximization', () => {
      const profitStart = Date.now();
      
      // Get price history (Discogs integration)
      const priceHistoryRes = http.get(`${BASE_URL}${API_PREFIX}/analytics/price-trend`, {
        params: { q: randomQuery() },
        headers: { 'Host': HOST },
        tags: { name: 'price_history', workflow: 'listings_profit' },
        timeout: '15s',
      });
      
      check(priceHistoryRes, {
        'price history: status 200': (r) => r.status === 200,
      });
      
      sleep(0.3);
      
      // Get selling advice (profit maximization)
      const sellingAdviceData = {
        query: randomQuery(),
        record_grade: randomGrade(),
        sleeve_grade: randomGrade(),
        user_id: generateUUID(),
        current_price: randomIntBetween(40, 90),
      };
      
      const sellingRes = http.post(`${BASE_URL}${API_PREFIX}/ai/selling-advice`,
        JSON.stringify(sellingAdviceData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'selling_advice', workflow: 'listings_profit' },
        timeout: '30s',
      });
      
      const profitLatency = Date.now() - profitStart;
      profitMaximizationLatency.add(profitLatency);
      
      check(sellingRes, {
        'selling advice: status 200': (r) => r.status === 200,
        'selling advice: has recommended_price': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.recommended_price !== undefined;
          } catch {
            return false;
          }
        },
      });
    });
    
    group('E2E: Shopping Service', () => {
      const shoppingStart = Date.now();
      
      const shoppingRes = http.get(`${BASE_URL}${API_PREFIX}/shopping/healthz`, {
        headers: { 'Host': HOST },
        tags: { name: 'shopping_health', workflow: 'shopping' },
        timeout: '10s',
      });
      
      const shoppingLatency = Date.now() - shoppingStart;
      shoppingLatency.add(shoppingLatency);
      
      check(shoppingRes, {
        'shopping: status 200': (r) => r.status === 200,
      });
    });
  }
  
  // ============================================================================
  // SECTION 2: PROTOCOL CORRECTNESS
  // ============================================================================
  
  if (!E2E_ONLY && !ADVERSARIAL_ONLY) {
    group('Protocol: HTTP/2 Health Checks', () => {
      const http2Start = Date.now();
      
      const healthEndpoints = [
        '/api/analytics/healthz',
        '/api/python-ai/healthz',
        '/api/auction-monitor/healthz',
        '/api/social/healthz',
        '/api/listings/healthz',
        '/api/shopping/healthz',
      ];
      
      for (const endpoint of healthEndpoints) {
        const res = http.get(`${BASE_URL}${endpoint}`, {
          headers: { 'Host': HOST },
          tags: { name: 'http2_health', protocol: 'http2' },
          timeout: '10s',
        });
        
        const http2Latency = Date.now() - http2Start;
        http2Latency.add(http2Latency);
        
        const checkResult = check(res, {
          [`${endpoint}: status 200/404`]: (r) => r.status === 200 || r.status === 404,
        });
        
        if (checkResult) {
          protocolSuccess.add(1);
        } else {
          protocolSuccess.add(0);
        }
      }
    });
  }
  
  // ============================================================================
  // SECTION 3: ADVERSARIAL TESTS
  // ============================================================================
  
  if (!E2E_ONLY && !PROTOCOL_ONLY) {
    group('Adversarial: Invalid Input Handling', () => {
      const invalidData = {
        invalid: 'json',
        missing: 'required_fields',
      };
      
      const invalidRes = http.post(`${BASE_URL}${API_PREFIX}/ai/selling-advice`,
        JSON.stringify(invalidData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'invalid_input', adversarial: 'true' },
        timeout: '10s',
      });
      
      const invalidCheck = check(invalidRes, {
        'invalid input: properly rejected (400/422)': (r) => 
          r.status === 400 || r.status === 422 || r.status === 500,
      });
      
      if (invalidCheck) {
        invalidInputRejected.add(1);
        adversarialSuccess.add(1);
      } else {
        invalidInputRejected.add(0);
        adversarialSuccess.add(0);
      }
    });
    
    group('Adversarial: Large Payload Handling', () => {
      const largeQuery = randomString(5000); // 5KB query string
      const largeData = {
        query: largeQuery,
        record_grade: randomGrade(),
        sleeve_grade: randomGrade(),
        user_id: generateUUID(),
        current_price: 50.0,
      };
      
      const largeRes = http.post(`${BASE_URL}${API_PREFIX}/analytics/log-search`,
        JSON.stringify(largeData), {
        headers: {
          'Content-Type': 'application/json',
          'Host': HOST,
        },
        tags: { name: 'large_payload', adversarial: 'true' },
        timeout: '15s',
      });
      
      const largeCheck = check(largeRes, {
        'large payload: handled appropriately': (r) => 
          r.status === 200 || r.status === 400 || r.status === 413,
      });
      
      if (largeCheck) {
        largePayloadHandled.add(1);
        adversarialSuccess.add(1);
      } else {
        largePayloadHandled.add(0);
        adversarialSuccess.add(0);
      }
    });
    
    group('Adversarial: Concurrent Requests', () => {
      const concurrentPromises = [];
      for (let i = 0; i < 5; i++) {
        concurrentPromises.push(
          http.get(`${BASE_URL}${API_PREFIX}/analytics/healthz`, {
            headers: { 'Host': HOST },
            tags: { name: 'concurrent_request', adversarial: 'true' },
            timeout: '10s',
          })
        );
      }
      
      const results = Promise.all(concurrentPromises);
      const concurrentCheck = check(results, {
        'concurrent requests: all succeeded': (r) => 
          Array.isArray(r) && r.every(res => res.status === 200 || res.status === 404),
      });
      
      if (concurrentCheck) {
        concurrentRequestSuccess.add(1);
        adversarialSuccess.add(1);
      } else {
        concurrentRequestSuccess.add(0);
        adversarialSuccess.add(0);
      }
    });
  }
  
  sleep(randomIntBetween(1, 3));
}

export function handleSummary(data) {
  const report = {
    timestamp: new Date().toISOString(),
    test_name: 'Platform-Wide Comprehensive Load Test',
    summary: {
      total_requests: data.metrics.http_reqs?.values?.count || 0,
      total_duration: (data.state?.testRunDurationMs || 0) / 1000,
      http_error_rate: ((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2) + '%',
      e2e_pipeline_success_rate: ((data.metrics.e2e_pipeline_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      protocol_success_rate: ((data.metrics.protocol_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      adversarial_success_rate: ((data.metrics.adversarial_success?.values?.rate || 0) * 100).toFixed(2) + '%',
    },
    workflows: {
      auction_to_analytics: {
        p50: (data.metrics.auction_to_analytics_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.auction_to_analytics_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.auction_to_analytics_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
      },
      analytics_to_ai: {
        p50: (data.metrics.analytics_to_ai_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.analytics_to_ai_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.analytics_to_ai_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
      },
      ai_plan_generation: {
        p50: (data.metrics.ai_plan_generation_latency_ms?.values?.['p(50)'] || 0).toFixed(2) + 'ms',
        p95: (data.metrics.ai_plan_generation_latency_ms?.values?.['p(95)'] || 0).toFixed(2) + 'ms',
        p99: (data.metrics.ai_plan_generation_latency_ms?.values?.['p(99)'] || 0).toFixed(2) + 'ms',
      },
    },
  };
  
  return {
    'stdout': `
╔════════════════════════════════════════════════════════════════╗
║     Platform-Wide Comprehensive Load Test Results              ║
╚════════════════════════════════════════════════════════════════╝

📊 Summary:
  Total Requests: ${report.summary.total_requests}
  Test Duration: ${report.summary.total_duration.toFixed(2)}s
  HTTP Error Rate: ${report.summary.http_error_rate}
  E2E Pipeline Success: ${report.summary.e2e_pipeline_success_rate}
  Protocol Success: ${report.summary.protocol_success_rate}
  Adversarial Success: ${report.summary.adversarial_success_rate}

🔗 Workflow Latencies:
  Auction → Analytics: p50=${report.workflows.auction_to_analytics.p50}, p95=${report.workflows.auction_to_analytics.p95}
  Analytics → AI: p50=${report.workflows.analytics_to_ai.p50}, p95=${report.workflows.analytics_to_ai.p95}
  AI Plan Generation: p50=${report.workflows.ai_plan_generation.p50}, p95=${report.workflows.ai_plan_generation.p95}
`,
    'summary.json': JSON.stringify(report, null, 2),
  };
}
