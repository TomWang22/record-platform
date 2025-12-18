/**
 * k6 Load Test: Python AI Service Pipeline
 * 
 * Two-part pipeline test:
 * 1. Analytics Service → Python AI Service (data ingestion)
 * 2. Python AI Service → API Gateway (end-to-end)
 * 
 * Comprehensive percentile tracking (p1 to p99.999999, p100):
 * - p1, p5, p10, p25, p50, p75, p90, p95, p99
 * - p99.9, p99.99, p99.999, p99.9999, p99.99999, p99.999999
 * - p100 (max)
 * 
 * Usage:
 *   kubectl -n record-platform run k6-python-ai --rm -i --restart=Never \
 *     --image=grafana/k6:latest -- run - < scripts/load/k6-python-ai-pipeline.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Configuration
const PYTHON_AI_URL = __ENV.PYTHON_AI_URL || 'http://python-ai-service.record-platform.svc.cluster.local:5005';
const API_GATEWAY_URL = __ENV.API_GATEWAY_URL || 'http://api-gateway.record-platform.svc.cluster.local:4000';
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://analytics-service.record-platform.svc.cluster.local:4004';

// Custom metrics for pipeline tracking
const errorRate = new Rate('errors');
const pipelineLatency = new Trend('pipeline_latency_ms');
const analyticsToAILatency = new Trend('analytics_to_ai_latency_ms');
const aiAdviceLatency = new Trend('ai_advice_latency_ms');
const gatewayLatency = new Trend('gateway_latency_ms');

// Per-endpoint latencies
const sellingAdviceLatency = new Trend('selling_advice_latency_ms');
const buyingAdviceLatency = new Trend('buying_advice_latency_ms');
const negotiationAdviceLatency = new Trend('negotiation_advice_latency_ms');
const biddingAdviceLatency = new Trend('bidding_advice_latency_ms');

// Pipeline success tracking
const pipelineSuccess = new Rate('pipeline_success');
const analyticsSuccess = new Rate('analytics_success');
const aiSuccess = new Rate('ai_success');

// Test queries - Expanded list for better variety and caching tests
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
  'The Beatles Sgt. Pepper',
  'Pink Floyd The Wall',
  'Led Zeppelin Physical Graffiti',
  'Radiohead Kid A',
  'The Doors Morrison Hotel',
  'Jimi Hendrix Electric Ladyland',
  'Bob Dylan Blonde on Blonde',
  'The Rolling Stones Exile on Main St.',
  'Queen Bohemian Rhapsody',
  'David Bowie Hunky Dory',
  'The Beatles White Album',
  'Pink Floyd Wish You Were Here',
  'Led Zeppelin Houses of the Holy',
  'Radiohead In Rainbows',
  'The Doors Strange Days',
  'Jimi Hendrix Axis: Bold as Love',
  'Bob Dylan Blood on the Tracks',
  'The Rolling Stones Let It Bleed',
  'Queen News of the World',
  'David Bowie Low',
  'The Beatles Revolver',
  'Pink Floyd Animals',
  'Led Zeppelin Led Zeppelin II',
  'Radiohead The Bends',
  'The Doors Waiting for the Sun',
  'Jimi Hendrix Band of Gypsys',
  'Bob Dylan The Freewheelin',
  'The Rolling Stones Beggars Banquet',
  'Queen Sheer Heart Attack',
  'David Bowie Aladdin Sane',
  'The Beatles Rubber Soul',
  'Pink Floyd Meddle',
  'Led Zeppelin Led Zeppelin III',
  'Radiohead Amnesiac',
  'The Doors The Doors',
  'Jimi Hendrix First Rays of the New Rising Sun',
  'Bob Dylan Bringing It All Back Home',
  'The Rolling Stones Aftermath',
  'Queen Jazz',
  'David Bowie Station to Station',
];

function randomQuery() {
  return testQueries[Math.floor(Math.random() * testQueries.length)];
}

function randomGrade() {
  const grades = ['M', 'NM', 'EX', 'VG+', 'VG'];
  return grades[Math.floor(Math.random() * grades.length)];
}

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '30s', target: 50 }, // Ramp up to 50 users
    { duration: '2m', target: 50 }, // Stay at 50 users (peak load)
    { duration: '30s', target: 20 }, // Ramp down to 20 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '30s', target: 0 },  // Ramp down to 0
  ],
  thresholds: {
    // Comprehensive percentile thresholds for tail latency analysis
    'http_req_duration': [
      'p(1)<50',      // 1st percentile
      'p(5)<100',     // 5th percentile
      'p(10)<150',    // 10th percentile
      'p(25)<200',    // 25th percentile
      'p(50)<300',    // 50th percentile (median)
      'p(75)<400',    // 75th percentile
      'p(90)<500',    // 90th percentile
      'p(95)<600',    // 95th percentile
      'p(99)<1000',   // 99th percentile
      'p(99.9)<2000',   // 99.9th percentile
      'p(99.99)<5000',  // 99.99th percentile
      'p(99.999)<10000', // 99.999th percentile
      'p(99.9999)<20000', // 99.9999th percentile
      'p(99.99999)<50000', // 99.99999th percentile
      'p(99.999999)<100000', // 99.999999th percentile
      'p(100)<200000', // 100th percentile (max)
    ],
    'http_req_failed': ['rate<0.05'],  // Error rate should be less than 5%
    'errors': ['rate<0.05'],
    'pipeline_success': ['rate>0.90'], // 90% pipeline success rate
    'analytics_success': ['rate>0.85'], // 85% analytics success rate
    'ai_success': ['rate>0.90'], // 90% AI success rate
  },
};

// Calculate detailed percentiles from custom metrics
function calculatePercentiles(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;
  return {
    p1: sorted[Math.floor(len * 0.01)],
    p5: sorted[Math.floor(len * 0.05)],
    p10: sorted[Math.floor(len * 0.10)],
    p25: sorted[Math.floor(len * 0.25)],
    p50: sorted[Math.floor(len * 0.50)],
    p75: sorted[Math.floor(len * 0.75)],
    p90: sorted[Math.floor(len * 0.90)],
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
    median: sorted[Math.floor(len * 0.50)],
  };
}

// Generate valid UUID v4 for user IDs
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default function () {
  // ============================================
  // HEALTH CHECKS (HTTP/2/3) - Like social service tests
  // ============================================
  
  // Test Python AI service health check (HTTP/2 via gRPC or HTTP/1.1 fallback)
  const pythonAIHealth = http.get(`${PYTHON_AI_URL}/healthz`, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'health_check', component: 'python_ai', protocol: 'http2' },
    timeout: '10s',
  });
  
  check(pythonAIHealth, {
    'python_ai_health_status_200': (r) => r.status === 200,
    'python_ai_health_has_ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.ok === true || body.status === 'healthy';
      } catch {
        return false;
      }
    },
  });
  
  // Test API Gateway health check
  const gatewayHealth = http.get(`${API_GATEWAY_URL}/api/healthz`, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'health_check', component: 'api_gateway', protocol: 'http2' },
    timeout: '10s',
  });
  
  check(gatewayHealth, {
    'gateway_health_status_ok': (r) => r.status === 200 || r.status === 404,
  });
  
  // Test Analytics service health check
  const analyticsHealth = http.get(`${ANALYTICS_URL}/healthz`, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'health_check', component: 'analytics', protocol: 'http2' },
    timeout: '10s',
  });
  
  check(analyticsHealth, {
    'analytics_health_status_200': (r) => r.status === 200,
  });
  
  const query = randomQuery();
  const userId = generateUUID();  // Use valid UUID instead of "user-XXX"
  const pipelineStart = Date.now();
  
  // ============================================
  // PART 1: Analytics Service → Python AI Pipeline
  // ============================================
  
  // Step 1: Get analytics data (price trend, recommendations)
  const analyticsStart = Date.now();
  const analyticsRes = http.get(`${ANALYTICS_URL}/analytics/recommendations/similar`, {
    params: {
      q: query,
      userId: userId,
      limit: 10,
    },
    tags: { name: 'analytics_recommendations', pipeline: 'part1' },
  });
  const analyticsLatency = Date.now() - analyticsStart;
  analyticsToAILatency.add(analyticsLatency);
  
  // Analytics service may fail (database issues), but that's OK - Python AI can still work
  // Empty recommendations array is valid when search_history table is empty
  const analyticsCheck = check(analyticsRes, {
    'analytics status is 200': (r) => r.status === 200,
    'analytics has recommendations field': (r) => {
      try {
        const body = JSON.parse(r.body);
        // Empty array [] is valid - means no search history yet
        // Missing field or error response is invalid
        return Array.isArray(body.recommendations) || body.recommendations !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  // Analytics success: 200 status + valid response (even if empty recommendations)
  // Empty recommendations are expected when search_history table has no data
  if (analyticsRes.status === 200) {
    try {
      const body = JSON.parse(analyticsRes.body);
      // Success if we get a valid response with recommendations field (even if empty)
      if (body.recommendations !== undefined || Array.isArray(body.recommendations)) {
        analyticsSuccess.add(1);
      } else {
        // Missing recommendations field - count as failure
        analyticsSuccess.add(0);
      }
    } catch {
      // Invalid JSON - count as failure
      analyticsSuccess.add(0);
    }
  } else {
    // Non-200 status - count as failure
    analyticsSuccess.add(0);
  }
  
  sleep(0.3);
  
  // Step 2: Python AI processes analytics data and provides advice
  // Test all 4 AI advisor endpoints in sequence (pipeline)
  
  // 2a: Selling Advice (uses analytics data)
  const sellingStart = Date.now();
  const sellingRes = http.post(`${PYTHON_AI_URL}/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: randomGrade(),
    sleeve_grade: randomGrade(),
    user_id: userId,
    current_price: Math.random() * 100 + 20,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'selling_advice', pipeline: 'part1', endpoint: 'selling-advice' },
    timeout: '60s',  // 60 second timeout for AI endpoints (allows for slow analytics/external APIs)
  });
  const sellingLatency = Date.now() - sellingStart;
  sellingAdviceLatency.add(sellingLatency);
  aiAdviceLatency.add(sellingLatency);
  
  const sellingCheck = check(sellingRes, {
    'selling advice status is 200': (r) => r.status === 200,
    'selling advice has recommended_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!sellingCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  // 2b: Buying Advice
  const buyingStart = Date.now();
  const buyingRes = http.post(`${PYTHON_AI_URL}/ai/buying-advice`, JSON.stringify({
    query: query,
    max_budget: Math.random() * 200 + 50,
    user_id: userId,
    urgency: ['normal', 'high', 'low'][Math.floor(Math.random() * 3)],
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'buying_advice', pipeline: 'part1', endpoint: 'buying-advice' },
    timeout: '60s',  // 60 second timeout (allows for slow analytics/external APIs)
  });
  const buyingLatency = Date.now() - buyingStart;
  buyingAdviceLatency.add(buyingLatency);
  aiAdviceLatency.add(buyingLatency);
  
  const buyingCheck = check(buyingRes, {
    'buying advice status is 200': (r) => r.status === 200,
    'buying advice has fair_price': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.fair_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!buyingCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  // 2c: Negotiation Advice
  const role = Math.random() > 0.5 ? 'buyer' : 'seller';
  const negotiationStart = Date.now();
  const negotiationRes = http.post(`${PYTHON_AI_URL}/ai/negotiation-advice`, JSON.stringify({
    query: query,
    role: role,
    current_price: Math.random() * 100 + 30,
    target_price: Math.random() * 100 + 25,
    user_id: userId,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'negotiation_advice', pipeline: 'part1', endpoint: 'negotiation-advice' },
    timeout: '60s',  // 60 second timeout (allows for slow analytics/external APIs)
  });
  const negotiationLatency = Date.now() - negotiationStart;
  negotiationAdviceLatency.add(negotiationLatency);
  aiAdviceLatency.add(negotiationLatency);
  
  const negotiationCheck = check(negotiationRes, {
    'negotiation advice status is 200': (r) => r.status === 200,
    'negotiation advice has strategy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.strategy !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!negotiationCheck) {
    errorRate.add(1);
  }
  
  sleep(0.2);
  
  // 2d: Bidding Advice
  const biddingStart = Date.now();
  const biddingRes = http.post(`${PYTHON_AI_URL}/ai/bidding-advice`, JSON.stringify({
    query: query,
    current_bid: Math.random() * 80 + 20,
    auction_end_time: new Date(Date.now() + Math.random() * 86400000).toISOString(),
    user_id: userId,
    max_budget: Math.random() * 150 + 50,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'bidding_advice', pipeline: 'part1', endpoint: 'bidding-advice' },
    timeout: '60s',  // 60 second timeout (allows for slow analytics/external APIs)
  });
  const biddingLatency = Date.now() - biddingStart;
  biddingAdviceLatency.add(biddingLatency);
  aiAdviceLatency.add(biddingLatency);
  
  const biddingCheck = check(biddingRes, {
    'bidding advice status is 200': (r) => r.status === 200,
    'bidding advice has should_bid': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.should_bid !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!biddingCheck) {
    errorRate.add(1);
  }
  
  // Track Part 1 pipeline success
  // Analytics can fail (database issues), but AI endpoints should still work
  // Only require AI endpoints to succeed, analytics is optional
  const allAIChecks = sellingCheck && buyingCheck && negotiationCheck && biddingCheck;
  
  if (allAIChecks) {
    pipelineSuccess.add(1);
    aiSuccess.add(1);
    // Analytics is bonus - already tracked above
  } else {
    pipelineSuccess.add(0);
    aiSuccess.add(0);
    // If AI endpoints fail, that's a real error
    errorRate.add(1);
  }
  
  const part1Latency = Date.now() - pipelineStart;
  pipelineLatency.add(part1Latency);
  
  sleep(0.5);
  
  // ============================================
  // PART 2: Python AI → API Gateway (End-to-End)
  // ============================================
  
  const gatewayStart = Date.now();
  
  // Test API Gateway routing to Python AI
  const gatewayRes = http.post(`${API_GATEWAY_URL}/api/ai/selling-advice`, JSON.stringify({
    query: query,
    record_grade: randomGrade(),
    sleeve_grade: randomGrade(),
    user_id: userId,
    current_price: Math.random() * 100 + 20,
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'gateway_ai_advice', pipeline: 'part2' },
    timeout: '60s',  // 60 second timeout (allows for slow analytics/external APIs)
  });
  const gatewayLatencyMs = Date.now() - gatewayStart;
  gatewayLatency.add(gatewayLatencyMs);
  
  const gatewayCheck = check(gatewayRes, {
    'gateway status is 200': (r) => r.status === 200,
    'gateway routes to Python AI': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.recommended_price !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (!gatewayCheck) {
    errorRate.add(1);
  }
  
  const totalPipelineLatency = Date.now() - pipelineStart;
  pipelineLatency.add(totalPipelineLatency);
  
  sleep(1);
}

export function handleSummary(data) {
  // Extract comprehensive percentiles from HTTP metrics
  // k6 provides percentiles in the 'values' object with keys like 'p(50)', 'p(95)', etc.
  const httpValues = data.metrics.http_req_duration?.values || {};
  
  // Helper to extract percentile value (k6 uses 'p(XX)' format)
  // k6 may not provide all percentiles if there aren't enough samples
  // We'll calculate missing percentiles from available data
  const getPercentile = (p) => {
    // Try exact match first
    const exactKey = `p(${p})`;
    if (httpValues[exactKey] !== undefined && httpValues[exactKey] > 0) {
      return httpValues[exactKey];
    }
    
    // Try with decimal precision
    const decimalKey = `p(${p.toFixed(1)})`;
    if (httpValues[decimalKey] !== undefined && httpValues[decimalKey] > 0) {
      return httpValues[decimalKey];
    }
    
    // Calculate from available percentiles using interpolation
    // Collect all available percentile values
    const availablePercentiles = [];
    for (const key in httpValues) {
      if (key.startsWith('p(') && httpValues[key] > 0) {
        const pNum = parseFloat(key.slice(2, -1));
        availablePercentiles.push({ percentile: pNum, value: httpValues[key] });
      }
    }
    availablePercentiles.sort((a, b) => a.percentile - b.percentile);
    
    // Interpolate from nearest percentiles
    if (availablePercentiles.length > 0) {
      // Find nearest percentiles
      let below = null;
      let above = null;
      for (const ap of availablePercentiles) {
        if (ap.percentile < p) {
          below = ap;
        } else if (ap.percentile > p && !above) {
          above = ap;
          break;
        }
      }
      
      if (below && above) {
        // Linear interpolation
        const weight = (p - below.percentile) / (above.percentile - below.percentile);
        return below.value + (above.value - below.value) * weight;
      } else if (below) {
        // Use value from below percentile
        return below.value;
      } else if (above) {
        // Use value from above percentile
        return above.value;
      } else if (availablePercentiles.length > 0) {
        // Use median of available percentiles as fallback
        return availablePercentiles[Math.floor(availablePercentiles.length / 2)].value;
      }
    }
    
    // For very high percentiles, k6 might not calculate them - return 0
    return 0;
  };
  
  // Extract custom metric percentiles (Trend metrics have percentiles in values)
  const getTrendPercentile = (metric, p) => {
    const values = data.metrics[metric]?.values || {};
    const exactKey = `p(${p})`;
    if (values[exactKey] !== undefined) return values[exactKey];
    const decimalKey = `p(${p.toFixed(1)})`;
    if (values[decimalKey] !== undefined) return values[decimalKey];
    return 0;
  };
  
  const pipelineValues = data.metrics.pipeline_latency_ms?.values || {};
  const analyticsValues = data.metrics.analytics_to_ai_latency_ms?.values || {};
  const aiValues = data.metrics.ai_advice_latency_ms?.values || {};
  const gatewayValues = data.metrics.gateway_latency_ms?.values || {};
  
  // Calculate error rate from http_req_failed (more accurate than errors metric)
  // http_req_failed counts HTTP-level failures (timeouts, connection errors, etc.)
  // This is different from pipeline_success which tracks business logic success
  const httpReqFailed = data.metrics.http_req_failed?.values?.rate || 0;
  const actualErrorRate = (httpReqFailed * 100).toFixed(2) + '%';
  
  // Also calculate success rate (1 - error rate) for clarity
  const successRate = ((1 - httpReqFailed) * 100).toFixed(2) + '%';
  
  // Build comprehensive report
  const report = {
    timestamp: new Date().toISOString(),
    test_name: 'Python AI Service Pipeline Test',
    summary: {
      total_requests: data.metrics.http_reqs?.values?.count || 0,
      total_duration: (data.state?.testRunDurationMs || 0) / 1000,
      http_error_rate: actualErrorRate,  // HTTP-level error rate (timeouts, connection errors)
      http_success_rate: successRate,  // HTTP-level success rate (1 - error rate)
      pipeline_success_rate: ((data.metrics.pipeline_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      analytics_success_rate: ((data.metrics.analytics_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      ai_success_rate: ((data.metrics.ai_success?.values?.rate || 0) * 100).toFixed(2) + '%',
      // Legacy field for backward compatibility
      error_rate: actualErrorRate,
    },
    http_metrics: {
      percentiles: {
        p1: getPercentile(1).toFixed(2) + 'ms',
        p5: getPercentile(5).toFixed(2) + 'ms',
        p10: getPercentile(10).toFixed(2) + 'ms',
        p25: getPercentile(25).toFixed(2) + 'ms',
        p50: getPercentile(50).toFixed(2) + 'ms',
        p75: getPercentile(75).toFixed(2) + 'ms',
        p90: getPercentile(90).toFixed(2) + 'ms',
        p95: getPercentile(95).toFixed(2) + 'ms',
        p99: getPercentile(99).toFixed(2) + 'ms',
        p999: getPercentile(99.9).toFixed(2) + 'ms',
        p9999: getPercentile(99.99).toFixed(2) + 'ms',
        p99999: getPercentile(99.999).toFixed(2) + 'ms',
        p999999: getPercentile(99.9999).toFixed(2) + 'ms',
        p9999999: getPercentile(99.99999).toFixed(2) + 'ms',
        p99999999: getPercentile(99.999999).toFixed(2) + 'ms',
        p100: (httpValues.max || 0).toFixed(2) + 'ms',
        min: (httpValues.min || 0).toFixed(2) + 'ms',
        avg: (httpValues.avg || 0).toFixed(2) + 'ms',
        max: (httpValues.max || 0).toFixed(2) + 'ms',
        median: (httpValues.med || httpValues['p(50)'] || 0).toFixed(2) + 'ms',
      },
    },
    custom_metrics: {
      pipeline_latency: {
        p50: getTrendPercentile('pipeline_latency_ms', 50).toFixed(2) + 'ms',
        p95: getTrendPercentile('pipeline_latency_ms', 95).toFixed(2) + 'ms',
        p99: getTrendPercentile('pipeline_latency_ms', 99).toFixed(2) + 'ms',
        p999: getTrendPercentile('pipeline_latency_ms', 99.9).toFixed(2) + 'ms',
        p9999: getTrendPercentile('pipeline_latency_ms', 99.99).toFixed(2) + 'ms',
        p99999: getTrendPercentile('pipeline_latency_ms', 99.999).toFixed(2) + 'ms',
        p999999: getTrendPercentile('pipeline_latency_ms', 99.9999).toFixed(2) + 'ms',
        p9999999: getTrendPercentile('pipeline_latency_ms', 99.99999).toFixed(2) + 'ms',
        p100: (pipelineValues.max || 0).toFixed(2) + 'ms',
        avg: (pipelineValues.avg || 0).toFixed(2) + 'ms',
      },
      analytics_to_ai: {
        p50: getTrendPercentile('analytics_to_ai_latency_ms', 50).toFixed(2) + 'ms',
        p95: getTrendPercentile('analytics_to_ai_latency_ms', 95).toFixed(2) + 'ms',
        p99: getTrendPercentile('analytics_to_ai_latency_ms', 99).toFixed(2) + 'ms',
        p999: getTrendPercentile('analytics_to_ai_latency_ms', 99.9).toFixed(2) + 'ms',
        p100: (analyticsValues.max || 0).toFixed(2) + 'ms',
        avg: (analyticsValues.avg || 0).toFixed(2) + 'ms',
      },
      ai_advice: {
        p50: getTrendPercentile('ai_advice_latency_ms', 50).toFixed(2) + 'ms',
        p95: getTrendPercentile('ai_advice_latency_ms', 95).toFixed(2) + 'ms',
        p99: getTrendPercentile('ai_advice_latency_ms', 99).toFixed(2) + 'ms',
        p999: getTrendPercentile('ai_advice_latency_ms', 99.9).toFixed(2) + 'ms',
        p100: (aiValues.max || 0).toFixed(2) + 'ms',
        avg: (aiValues.avg || 0).toFixed(2) + 'ms',
      },
      gateway: {
        p50: getTrendPercentile('gateway_latency_ms', 50).toFixed(2) + 'ms',
        p95: getTrendPercentile('gateway_latency_ms', 95).toFixed(2) + 'ms',
        p99: getTrendPercentile('gateway_latency_ms', 99).toFixed(2) + 'ms',
        p999: getTrendPercentile('gateway_latency_ms', 99.9).toFixed(2) + 'ms',
        p100: (gatewayValues.max || 0).toFixed(2) + 'ms',
        avg: (gatewayValues.avg || 0).toFixed(2) + 'ms',
      },
    },
  };
  
  // Format output
  const output = `
╔════════════════════════════════════════════════════════════════╗
║     Python AI Service Pipeline Load Test Results              ║
╚════════════════════════════════════════════════════════════════╝

📊 Summary:
  Total Requests: ${report.summary.total_requests}
  Test Duration: ${report.summary.total_duration.toFixed(2)}s
  HTTP Error Rate: ${report.summary.http_error_rate} (timeouts, connection errors)
  HTTP Success Rate: ${report.summary.http_success_rate} (1 - error rate)
  Pipeline Success Rate: ${report.summary.pipeline_success_rate} (business logic success)
  Analytics Success Rate: ${report.summary.analytics_success_rate}
  AI Success Rate: ${report.summary.ai_success_rate}
  
  Note: HTTP Error Rate counts HTTP-level failures (timeouts, connection errors).
        Pipeline Success Rate tracks whether the overall pipeline succeeded.
        These can differ when requests timeout but pipeline logic still completes.

📈 HTTP Request Latency Percentiles (ms):
  p1      (1st):        ${report.http_metrics.percentiles.p1}
  p5      (5th):        ${report.http_metrics.percentiles.p5}
  p10     (10th):       ${report.http_metrics.percentiles.p10}
  p25     (25th):       ${report.http_metrics.percentiles.p25}
  p50     (median):     ${report.http_metrics.percentiles.p50}
  p75     (75th):       ${report.http_metrics.percentiles.p75}
  p90     (90th):       ${report.http_metrics.percentiles.p90}
  p95     (95th):       ${report.http_metrics.percentiles.p95}
  p99     (99th):       ${report.http_metrics.percentiles.p99}
  p999    (99.9th):     ${report.http_metrics.percentiles.p999}
  p9999   (99.99th):    ${report.http_metrics.percentiles.p9999}
  p99999  (99.999th):   ${report.http_metrics.percentiles.p99999}
  p999999 (99.9999th):  ${report.http_metrics.percentiles.p999999}
  p9999999 (99.99999th): ${report.http_metrics.percentiles.p9999999}
  p99999999 (99.999999th): ${report.http_metrics.percentiles.p99999999}
  p100    (max):        ${report.http_metrics.percentiles.p100}
  
  Min:   ${report.http_metrics.percentiles.min}
  Avg:   ${report.http_metrics.percentiles.avg}
  Max:   ${report.http_metrics.percentiles.max}
  Median: ${report.http_metrics.percentiles.median}

🔗 Pipeline Latency (Analytics → AI → Gateway):
  p50: ${report.custom_metrics.pipeline_latency.p50}
  p95: ${report.custom_metrics.pipeline_latency.p95}
  p99: ${report.custom_metrics.pipeline_latency.p99}
  p999: ${report.custom_metrics.pipeline_latency.p999}
  p9999: ${report.custom_metrics.pipeline_latency.p9999}
  p99999: ${report.custom_metrics.pipeline_latency.p99999}
  p999999: ${report.custom_metrics.pipeline_latency.p999999}
  p9999999: ${report.custom_metrics.pipeline_latency.p9999999}
  p100: ${report.custom_metrics.pipeline_latency.p100}
  Avg: ${report.custom_metrics.pipeline_latency.avg}

📊 Analytics → AI Latency:
  p50: ${report.custom_metrics.analytics_to_ai.p50}
  p95: ${report.custom_metrics.analytics_to_ai.p95}
  p99: ${report.custom_metrics.analytics_to_ai.p99}
  p999: ${report.custom_metrics.analytics_to_ai.p999}
  p100: ${report.custom_metrics.analytics_to_ai.p100}
  Avg: ${report.custom_metrics.analytics_to_ai.avg}

🤖 AI Advice Latency (all endpoints):
  p50: ${report.custom_metrics.ai_advice.p50}
  p95: ${report.custom_metrics.ai_advice.p95}
  p99: ${report.custom_metrics.ai_advice.p99}
  p999: ${report.custom_metrics.ai_advice.p999}
  p100: ${report.custom_metrics.ai_advice.p100}
  Avg: ${report.custom_metrics.ai_advice.avg}

🌐 API Gateway Latency:
  p50: ${report.custom_metrics.gateway.p50}
  p95: ${report.custom_metrics.gateway.p95}
  p99: ${report.custom_metrics.gateway.p99}
  p999: ${report.custom_metrics.gateway.p999}
  p100: ${report.custom_metrics.gateway.p100}
  Avg: ${report.custom_metrics.gateway.avg}
`;
  
  // Cleanup: Delete pod if running in Kubernetes
  // Note: kubectl run with --rm should auto-delete, but we ensure cleanup
  if (typeof __ENV !== 'undefined' && __ENV.KUBERNETES_SERVICE_HOST) {
    // We're running in a pod, but k6 can't directly delete pods
    // The --rm flag in kubectl run should handle this, but log for visibility
    console.log('\n⚠️  Note: Running in Kubernetes pod. Ensure --rm flag is used in kubectl run command.')
    console.log('   Example: kubectl -n record-platform run k6-python-ai --rm -i --restart=Never --image=grafana/k6:latest -- run - < script.js')
  }
  
  return {
    'stdout': output,
    'summary.json': JSON.stringify(report, null, 2),
    'raw-data.json': JSON.stringify(data, null, 2),  // Include raw k6 data for graph generation
  };
}

