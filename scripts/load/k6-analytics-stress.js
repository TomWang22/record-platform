/**
 * k6 Stress Test: Analytics Pipeline Under Load
 * 
 * Hard stress testing of analytics pipeline:
 * - High concurrent load
 * - Long duration
 * - Real data patterns
 * - Validates data quality under stress
 * 
 * Usage:
 *   k6 run --vus 100 --duration 10m scripts/load/k6-analytics-stress.js
 *   k6 run --stages 0s:10,30s:50,2m:100,5m:100,7m:50,10m:0 scripts/load/k6-analytics-stress.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const AUCTION_MONITOR_URL = __ENV.AUCTION_MONITOR_URL || 'http://localhost:4008';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '5m';

// Custom metrics
const percentileValidation = new Rate('percentile_validation');
const pythonAIReady = new Rate('python_ai_ready');
const dataQualityScore = new Trend('data_quality_score');
const throughput = new Trend('throughput_ops_per_sec');
const errors = new Counter('errors');

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

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.10'], // Allow up to 10% failure under stress
    'percentile_validation': ['rate>0.85'], // Lower threshold under stress
    'python_ai_ready': ['rate>0.80'],
    'data_quality_score': ['avg>0.75'],
  },
};

export default function () {
  const query = getRandomQuery();
  const startTime = Date.now();
  
  // Test 1: Price trend query (read-heavy)
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
    'price trend response time < 2s': (r) => r.timings.duration < 2000,
  });
  
  if (!trendCheck) {
    errors.add(1);
  }
  
  sleep(0.1);
  
  // Test 2: Fuzzy search (read-heavy, complex query)
  const fuzzyRes = http.get(`${ANALYTICS_URL}/analytics/fuzzy-search`, {
    params: {
      q: query,
      limit: 20,
    },
    tags: { name: 'fuzzy_search', type: 'read' },
  });
  
  const fuzzyCheck = check(fuzzyRes, {
    'fuzzy search status is 200': (r) => r.status === 200,
    'fuzzy search response time < 3s': (r) => r.timings.duration < 3000,
  });
  
  if (fuzzyCheck && fuzzyRes.status === 200) {
    try {
      const body = JSON.parse(fuzzyRes.body);
      if (body.results && body.results.priceMatches) {
        const matches = body.results.priceMatches;
        if (matches.length > 0) {
          // Validate data quality
          const match = matches[0];
          if (match.sample_count >= 10) {
            dataQualityScore.add(0.9);
            percentileValidation.add(1);
          } else if (match.sample_count >= 5) {
            dataQualityScore.add(0.7);
            percentileValidation.add(0.5);
          } else {
            dataQualityScore.add(0.5);
            percentileValidation.add(0);
          }
        }
      }
    } catch (e) {
      errors.add(1);
    }
  } else {
    errors.add(1);
  }
  
  sleep(0.2);
  
  // Test 3: Predict price (write-heavy, uses worker threads)
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
  
  if (predictCheck) {
    try {
      const body = JSON.parse(predictRes.body);
      if (body.samples >= 10) {
        pythonAIReady.add(1);
      } else if (body.samples >= 5) {
        pythonAIReady.add(0.5);
      } else {
        pythonAIReady.add(0);
      }
    } catch (e) {
      errors.add(1);
    }
  } else {
    errors.add(1);
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  throughput.add(1 / duration); // ops per second
  
  sleep(0.3);
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  
  return {
    'stdout': `
🔥 Analytics Pipeline Stress Test Results
=========================================

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
  P99.9 Duration: ${(data.metrics.http_req_duration?.values?.['p(99.9)'] || 0).toFixed(2)}ms

Data Quality Under Stress:
  Percentile Validation: ${((data.metrics.percentile_validation?.values?.rate || 0) * 100).toFixed(1)}%
  Python AI Ready: ${((data.metrics.python_ai_ready?.values?.rate || 0) * 100).toFixed(1)}%
  Avg Data Quality Score: ${(data.metrics.data_quality_score?.values?.avg || 0).toFixed(3)}
  Errors: ${data.metrics.errors?.values?.count || 0}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.10 && 
         (data.metrics.percentile_validation?.values?.rate || 0) > 0.85 ? '✅ PASS' : '⚠️  DEGRADED'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

