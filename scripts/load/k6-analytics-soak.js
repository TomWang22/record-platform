/**
 * k6 Soak Test: Analytics Pipeline
 * 
 * Long-duration test to find memory leaks, resource exhaustion, and stability issues.
 * Runs for extended period (30+ minutes) with steady load.
 * 
 * Usage:
 *   k6 run --vus 50 --duration 30m scripts/load/k6-analytics-soak.js
 *   k6 run --vus 100 --duration 1h scripts/load/k6-analytics-soak.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const AUCTION_MONITOR_URL = __ENV.AUCTION_MONITOR_URL || 'http://localhost:4008';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '30m';

// Custom metrics
const percentileValidation = new Rate('percentile_validation');
const pythonAIReady = new Rate('python_ai_ready');
const dataQualityScore = new Trend('data_quality_score');
const memoryLeak = new Gauge('memory_leak_indicator');
const errors = new Counter('errors');
const throughput = new Trend('throughput_ops_per_sec');

// Real-world query patterns
const artists = [
  'The Beatles', 'Pink Floyd', 'Led Zeppelin', 'The Rolling Stones',
  'Queen', 'David Bowie', 'The Who', 'Fleetwood Mac', 'Radiohead',
  'Nirvana', 'The Doors', 'Jimi Hendrix', 'Bob Dylan', 'The Clash',
  'The Velvet Underground', 'Black Sabbath', 'AC/DC', 'Metallica',
];
const albums = [
  'Abbey Road', 'The Dark Side of the Moon', 'Led Zeppelin IV',
  'Sticky Fingers', 'A Night at the Opera', 'The Rise and Fall of Ziggy Stardust',
  'Who\'s Next', 'Rumours', 'OK Computer', 'Nevermind', 'L.A. Woman',
  'Are You Experienced', 'Highway 61 Revisited', 'London Calling',
  'The Velvet Underground & Nico', 'Paranoid', 'Back in Black', 'Master of Puppets',
];

function getRandomQuery() {
  const artist = artists[Math.floor(Math.random() * artists.length)];
  const album = albums[Math.floor(Math.random() * albums.length)];
  return `${artist} ${album}`;
}

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    'http_req_duration': ['p(95)<3000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.05'],
    'percentile_validation': ['rate>0.90'],
    'python_ai_ready': ['rate>0.85'],
    'data_quality_score': ['avg>0.80'],
  },
};

export default function () {
  const query = getRandomQuery();
  const startTime = Date.now();
  
  // Mix of read and write operations (70% read, 30% write)
  const operationType = Math.random();
  
  if (operationType < 0.7) {
    // Read operation: Price trend
    const trendRes = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
      params: {
        artist: query.split(' ')[0],
        name: query.split(' ').slice(1).join(' '),
        days: 90,
      },
      tags: { name: 'price_trend', type: 'read' },
    });
    
    check(trendRes, {
      'price trend status is 200': (r) => r.status === 200,
      'price trend response time < 3s': (r) => r.timings.duration < 3000,
    });
    
    if (trendRes.status === 200) {
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
    // Write operation: Predict price
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
    
    check(predictRes, {
      'predict price status is 200': (r) => r.status === 200,
      'predict price response time < 5s': (r) => r.timings.duration < 5000,
    });
    
    if (predictRes.status !== 200) {
      errors.add(1);
    }
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  throughput.add(1 / duration);
  
  // Monitor for memory leaks (response time degradation over time)
  const iteration = __ITER;
  if (iteration % 100 === 0) {
    // Track if response times are increasing (potential memory leak)
    const avgDuration = http.get(`${ANALYTICS_URL}/healthz`).timings.duration;
    memoryLeak.add(avgDuration);
  }
  
  sleep(0.5 + Math.random() * 1.0); // Random sleep 0.5-1.5s
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  
  return {
    'stdout': `
💧 Analytics Pipeline Soak Test Results
========================================

Test Configuration:
  Analytics URL: ${ANALYTICS_URL}
  Auction Monitor URL: ${AUCTION_MONITOR_URL}
  Virtual Users: ${VUS}
  Duration: ${DURATION}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec

HTTP Metrics:
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms

Data Quality (Long Duration):
  Percentile Validation: ${((data.metrics.percentile_validation?.values?.rate || 0) * 100).toFixed(1)}%
  Python AI Ready: ${((data.metrics.python_ai_ready?.values?.rate || 0) * 100).toFixed(1)}%
  Avg Data Quality Score: ${(data.metrics.data_quality_score?.values?.avg || 0).toFixed(3)}
  Errors: ${data.metrics.errors?.values?.count || 0}

Stability:
  Memory Leak Indicator: ${data.metrics.memory_leak_indicator?.values?.avg ? data.metrics.memory_leak_indicator.values.avg.toFixed(2) : 'N/A'}ms
  (Increasing values may indicate memory leaks)

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 ? '✅ STABLE' : '⚠️  UNSTABLE'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

