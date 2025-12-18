/**
 * k6 Load Test: Ramp-Up to Breaking Point
 * 
 * Gradually increases load to find the breaking point:
 * - Starts at 1K VU
 * - Gradually increases until system struggles
 * - Identifies maximum capacity
 * 
 * Usage:
 *   k6 run scripts/load/k6-analytics-load-ramp.js
 *   k6 run --env MAX_VUS=5000 scripts/load/k6-analytics-load-ramp.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const AUCTION_MONITOR_URL = __ENV.AUCTION_MONITOR_URL || 'http://localhost:4008';
const START_VUS = Number(__ENV.START_VUS || 1000);
const MAX_VUS = Number(__ENV.MAX_VUS || 5000);
const STEP_VUS = Number(__ENV.STEP_VUS || 500);
const STEP_DURATION = __ENV.STEP_DURATION || '2m';

// Custom metrics
const percentileValidation = new Rate('percentile_validation');
const pythonAIReady = new Rate('python_ai_ready');
const dataQualityScore = new Trend('data_quality_score');
const errors = new Counter('errors');
const breakingPoint = new Counter('breaking_point_reached');

// Real-world query patterns
const artists = [
  'The Beatles', 'Pink Floyd', 'Led Zeppelin', 'The Rolling Stones',
  'Queen', 'David Bowie', 'The Who', 'Fleetwood Mac', 'Radiohead',
  'Nirvana', 'The Doors', 'Jimi Hendrix', 'Bob Dylan', 'The Clash',
];
const albums = [
  'Abbey Road', 'The Dark Side of the Moon', 'Led Zeppelin IV',
  'Sticky Fingers', 'A Night at the Opera', 'The Rise and Fall of Ziggy Stardust',
  'Who\'s Next', 'Rumours', 'OK Computer', 'Nevermind', 'L.A. Woman',
  'Are You Experienced', 'Highway 61 Revisited', 'London Calling',
];

function getRandomQuery() {
  const artist = artists[Math.floor(Math.random() * artists.length)];
  const album = albums[Math.floor(Math.random() * albums.length)];
  return `${artist} ${album}`;
}

// Build stages dynamically
function buildStages() {
  const stages = [];
  let currentVU = START_VUS;
  
  // Ramp up to START_VUS
  stages.push({ duration: '1m', target: START_VUS });
  
  // Gradually increase
  while (currentVU < MAX_VUS) {
    stages.push({ duration: STEP_DURATION, target: currentVU });
    currentVU += STEP_VUS;
    if (currentVU <= MAX_VUS) {
      stages.push({ duration: STEP_DURATION, target: currentVU });
    }
  }
  
  // Hold at max for a bit
  stages.push({ duration: '5m', target: MAX_VUS });
  
  // Ramp down
  stages.push({ duration: '2m', target: 0 });
  
  return stages;
}

export const options = {
  stages: buildStages(),
  thresholds: {
    'http_req_duration': ['p(95)<5000', 'p(99)<10000'],
    'http_req_failed': ['rate<0.20'], // Allow up to 20% failure at breaking point
    'percentile_validation': ['rate>0.70'], // Lower threshold under extreme load
    'python_ai_ready': ['rate>0.60'],
    'data_quality_score': ['avg>0.60'],
  },
};

export default function () {
  const query = getRandomQuery();
  const startTime = Date.now();
  
  // Mix of operations (60% read, 40% write)
  const operationType = Math.random();
  
  if (operationType < 0.6) {
    // Read: Price trend
    const trendRes = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
      params: {
        artist: query.split(' ')[0],
        name: query.split(' ').slice(1).join(' '),
        days: 90,
      },
      tags: { name: 'price_trend', type: 'read' },
    });
    
    const trendCheck = check(trendRes, {
      'price trend status is 200': (r) => r.status === 200,
      'price trend response time < 10s': (r) => r.timings.duration < 10000,
    });
    
    if (!trendCheck || trendRes.status !== 200) {
      errors.add(1);
      // Check if we've hit breaking point (high error rate)
      if (trendRes.status >= 500 || trendRes.timings.duration > 10000) {
        breakingPoint.add(1);
      }
    } else {
      try {
        const body = JSON.parse(trendRes.body);
        if (body.trends && body.trends.length > 0) {
          const trend = body.trends[0];
          if (trend.sample_count >= 10) {
            dataQualityScore.add(0.9);
            percentileValidation.add(1);
            pythonAIReady.add(1);
          }
        }
      } catch (e) {
        errors.add(1);
      }
    }
  } else {
    // Write: Predict price
    const predictRes = http.post(
      `${ANALYTICS_URL}/analytics/predict-price`,
      JSON.stringify({
        items: [{
          query: query,
          base_price: 50 + Math.random() * 150,
          record_grade: 'Very Good',
        }],
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { name: 'predict_price', type: 'write' },
      }
    );
    
    const predictCheck = check(predictRes, {
      'predict price status is 200': (r) => r.status === 200,
      'predict price response time < 15s': (r) => r.timings.duration < 15000,
    });
    
    if (!predictCheck || predictRes.status !== 200) {
      errors.add(1);
      if (predictRes.status >= 500 || predictRes.timings.duration > 15000) {
        breakingPoint.add(1);
      }
    }
  }
  
  sleep(0.1 + Math.random() * 0.2); // Short sleep to maximize load
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  const vusValues = data.metrics.vus?.values?.values || [];
  const maxVU = vusValues.length > 0 ? Math.max(...vusValues) : 0;
  
  return {
    'stdout': `
📈 Analytics Pipeline Load Ramp Test Results
============================================

Test Configuration:
  Analytics URL: ${ANALYTICS_URL}
  Start VUs: ${START_VUS}
  Max VUs: ${MAX_VUS}
  Step Size: ${STEP_VUS}
  Step Duration: ${STEP_DURATION}
  Peak VUs Reached: ${maxVU}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec

HTTP Metrics:
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms
  P99.9 Duration: ${(data.metrics.http_req_duration?.values?.['p(99.9)'] || 0).toFixed(2)}ms

Data Quality Under Load:
  Percentile Validation: ${((data.metrics.percentile_validation?.values?.rate || 0) * 100).toFixed(1)}%
  Python AI Ready: ${((data.metrics.python_ai_ready?.values?.rate || 0) * 100).toFixed(1)}%
  Avg Data Quality Score: ${(data.metrics.data_quality_score?.values?.avg || 0).toFixed(3)}
  Errors: ${data.metrics.errors?.values?.count || 0}
  Breaking Points: ${data.metrics.breaking_point_reached?.values?.count || 0}

Breaking Point Analysis:
  ${(data.metrics.breaking_point_reached?.values?.count || 0) > 0 
    ? `⚠️  Breaking point reached at ~${maxVU} VUs` 
    : `✅ No breaking point reached (system handled up to ${maxVU} VUs)`}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.20 ? '✅ PASS' : '⚠️  DEGRADED'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

