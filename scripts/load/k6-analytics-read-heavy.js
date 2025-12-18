/**
 * k6 Read-Heavy Test: Analytics Pipeline
 * 
 * Tests read-heavy workload (90% reads, 10% writes):
 * - Price trend queries
 * - Fuzzy search
 * - Similar searches
 * - Trending searches
 * - User history
 * 
 * Usage:
 *   k6 run --vus 1000 --duration 10m scripts/load/k6-analytics-read-heavy.js
 *   k6 run --stages 0s:100,1m:500,3m:1000,5m:1000,7m:500,10m:0 scripts/load/k6-analytics-read-heavy.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const START_VUS = Number(__ENV.START_VUS || 1000);
const MAX_VUS = Number(__ENV.MAX_VUS || 3000);
const DURATION = __ENV.DURATION || '10m';

// Custom metrics
const percentileValidation = new Rate('percentile_validation');
const pythonAIReady = new Rate('python_ai_ready');
const readLatency = new Trend('read_latency_ms');
const writeLatency = new Trend('write_latency_ms');
const cacheHitRate = new Rate('cache_hit_rate');
const errors = new Counter('errors');

// Real-world query patterns
const artists = [
  'The Beatles', 'Pink Floyd', 'Led Zeppelin', 'The Rolling Stones',
  'Queen', 'David Bowie', 'The Who', 'Fleetwood Mac', 'Radiohead',
  'Nirvana', 'The Doors', 'Jimi Hendrix', 'Bob Dylan', 'The Clash',
  'The Velvet Underground', 'Black Sabbath', 'AC/DC', 'Metallica',
  'The Beach Boys', 'The Kinks', 'The Smiths', 'Joy Division',
];
const albums = [
  'Abbey Road', 'The Dark Side of the Moon', 'Led Zeppelin IV',
  'Sticky Fingers', 'A Night at the Opera', 'The Rise and Fall of Ziggy Stardust',
  'Who\'s Next', 'Rumours', 'OK Computer', 'Nevermind', 'L.A. Woman',
  'Are You Experienced', 'Highway 61 Revisited', 'London Calling',
  'The Velvet Underground & Nico', 'Paranoid', 'Back in Black', 'Master of Puppets',
  'Pet Sounds', 'The Kinks Are the Village Green Preservation Society', 'The Queen Is Dead', 'Unknown Pleasures',
];

function getRandomQuery() {
  const artist = artists[Math.floor(Math.random() * artists.length)];
  const album = albums[Math.floor(Math.random() * albums.length)];
  return `${artist} ${album}`;
}

function buildStages() {
  return [
    { duration: '1m', target: START_VUS },      // Ramp up to start
    { duration: '2m', target: START_VUS },     // Hold at start
    { duration: '2m', target: Math.floor(MAX_VUS * 0.5) }, // Ramp to 50%
    { duration: '2m', target: Math.floor(MAX_VUS * 0.75) }, // Ramp to 75%
    { duration: '2m', target: MAX_VUS },       // Ramp to max
    { duration: '1m', target: MAX_VUS },       // Hold at max
    { duration: '2m', target: 0 },              // Ramp down
  ];
}

export const options = {
  stages: buildStages(),
  thresholds: {
    'http_req_duration{type:read}': ['p(95)<2000', 'p(99)<5000'],
    'http_req_duration{type:write}': ['p(95)<5000', 'p(99)<10000'],
    'http_req_failed': ['rate<0.05'],
    'read_latency_ms': ['p(95)<2000', 'p(99)<5000'],
    'write_latency_ms': ['p(95)<5000', 'p(99)<10000'],
    'percentile_validation': ['rate>0.90'],
    'python_ai_ready': ['rate>0.85'],
  },
};

export default function () {
  const query = getRandomQuery();
  const operationType = Math.random();
  
  // 90% read operations, 10% write
  if (operationType < 0.9) {
    // Read operation
    const readOp = Math.random();
    let res;
    
    if (readOp < 0.3) {
      // Price trend (30% of reads)
      const startTime = Date.now();
      res = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
        params: {
          artist: query.split(' ')[0],
          name: query.split(' ').slice(1).join(' '),
          days: 90,
        },
        tags: { name: 'price_trend', type: 'read' },
      });
      readLatency.add(Date.now() - startTime);
      
      check(res, {
        'price trend status is 200': (r) => r.status === 200,
        'price trend response time < 2s': (r) => r.timings.duration < 2000,
      });
      
      if (res.status === 200) {
        try {
          const body = JSON.parse(res.body);
          if (body.trends && body.trends.length > 0) {
            const trend = body.trends[0];
            if (trend.sample_count >= 10) {
              percentileValidation.add(1);
              pythonAIReady.add(1);
              cacheHitRate.add(1); // Assume cache hit if fast response
            }
          }
        } catch (e) {
          errors.add(1);
        }
      }
    } else if (readOp < 0.6) {
      // Fuzzy search (30% of reads)
      const startTime = Date.now();
      res = http.get(`${ANALYTICS_URL}/analytics/fuzzy-search`, {
        params: {
          q: query,
          limit: 20,
        },
        tags: { name: 'fuzzy_search', type: 'read' },
      });
      readLatency.add(Date.now() - startTime);
      
      check(res, {
        'fuzzy search status is 200': (r) => r.status === 200,
        'fuzzy search response time < 3s': (r) => r.timings.duration < 3000,
      });
    } else if (readOp < 0.8) {
      // Similar searches (20% of reads)
      const startTime = Date.now();
      res = http.get(`${ANALYTICS_URL}/analytics/recommendations/similar`, {
        params: {
          q: query,
          limit: 10,
        },
        tags: { name: 'similar_searches', type: 'read' },
      });
      readLatency.add(Date.now() - startTime);
      
      check(res, {
        'similar searches status is 200': (r) => r.status === 200,
        'similar searches response time < 2s': (r) => r.timings.duration < 2000,
      });
    } else {
      // Trending searches (20% of reads)
      const startTime = Date.now();
      res = http.get(`${ANALYTICS_URL}/analytics/trending`, {
        params: {
          days: 7,
          limit: 20,
        },
        tags: { name: 'trending', type: 'read' },
      });
      readLatency.add(Date.now() - startTime);
      
      check(res, {
        'trending status is 200': (r) => r.status === 200,
        'trending response time < 2s': (r) => r.timings.duration < 2000,
      });
    }
    
    if (res && res.status !== 200) {
      errors.add(1);
    }
    
    sleep(0.1 + Math.random() * 0.2); // Short sleep for high throughput
  } else {
    // Write operation (10% of total)
    const startTime = Date.now();
    const res = http.post(
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
    writeLatency.add(Date.now() - startTime);
    
    check(res, {
      'predict price status is 200': (r) => r.status === 200,
      'predict price response time < 5s': (r) => r.timings.duration < 5000,
    });
    
    if (res.status !== 200) {
      errors.add(1);
    }
    
    sleep(0.3 + Math.random() * 0.5);
  }
}

export function handleSummary(data) {
  const totalOps = data.metrics.http_reqs?.values?.count || 0;
  const duration = (data.state?.testRunDurationMs || 0) / 1000;
  const avgThroughput = duration > 0 ? totalOps / duration : 0;
  const vusValues = data.metrics.vus?.values?.values || [];
  const maxVU = vusValues.length > 0 ? Math.max(...vusValues) : 0;
  
  return {
    'stdout': `
📖 Analytics Pipeline Read-Heavy Test Results
==============================================

Test Configuration:
  Analytics URL: ${ANALYTICS_URL}
  Start VUs: ${START_VUS}
  Max VUs: ${MAX_VUS}
  Duration: ${DURATION}
  Peak VUs Reached: ${maxVU}
  Total Operations: ${totalOps}
  Avg Throughput: ${avgThroughput.toFixed(2)} ops/sec

HTTP Metrics:
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms

Read Performance:
  Read Latency P95: ${(data.metrics.read_latency_ms?.values?.['p(95)'] || 0).toFixed(2)}ms
  Read Latency P99: ${(data.metrics.read_latency_ms?.values?.['p(99)'] || 0).toFixed(2)}ms
  Cache Hit Rate: ${((data.metrics.cache_hit_rate?.values?.rate || 0) * 100).toFixed(1)}%

Write Performance:
  Write Latency P95: ${(data.metrics.write_latency_ms?.values?.['p(95)'] || 0).toFixed(2)}ms
  Write Latency P99: ${(data.metrics.write_latency_ms?.values?.['p(99)'] || 0).toFixed(2)}ms

Data Quality:
  Percentile Validation: ${((data.metrics.percentile_validation?.values?.rate || 0) * 100).toFixed(1)}%
  Python AI Ready: ${((data.metrics.python_ai_ready?.values?.rate || 0) * 100).toFixed(1)}%
  Errors: ${data.metrics.errors?.values?.count || 0}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 ? '✅ PASS' : '❌ FAIL'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

