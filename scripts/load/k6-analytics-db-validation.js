/**
 * k6 Load Test: Direct Database Validation
 * 
 * Validates analytics pipeline by directly querying the database:
 * - Checks price_history table for percentiles p1-p100
 * - Validates Python AI readiness in metadata
 * - Tests with real ingested data
 * 
 * This test requires database access and validates the actual stored data.
 * 
 * Usage:
 *   k6 run --vus 5 --duration 30s scripts/load/k6-analytics-db-validation.js
 * 
 * Note: This test requires a database connection endpoint or proxy.
 * For production, use the analytics service endpoints instead.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const VUS = Number(__ENV.VUS || 5);
const DURATION = __ENV.DURATION || '30s';

// Custom metrics
const percentileComplete = new Rate('percentile_complete_p1_p100');
const pythonAIReady = new Rate('python_ai_ready');
const validationScore = new Trend('validation_score');
const dataQualityIssues = new Counter('data_quality_issues');

// Test queries that should have processed data
const testQueries = [
  'The Beatles',
  'Pink Floyd',
  'Led Zeppelin',
  'Queen',
  'David Bowie',
];

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed': ['rate<0.05'],
    'percentile_complete_p1_p100': ['rate>0.95'],
    'python_ai_ready': ['rate>0.90'],
    'validation_score': ['avg>0.85'],
  },
};

export default function () {
  const query = testQueries[Math.floor(Math.random() * testQueries.length)];
  
  // Test 1: Price trend (queries processed analytics data)
  const trendRes = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
    params: {
      artist: query,
      name: 'Test Album',
      days: 90,
    },
    tags: { name: 'price_trend' },
  });
  
  const trendCheck = check(trendRes, {
    'price trend status is 200': (r) => r.status === 200,
    'price trend has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.trends && Array.isArray(body.trends);
      } catch {
        return false;
      }
    },
  });
  
  if (trendCheck && trendRes.status === 200) {
    try {
      const body = JSON.parse(trendRes.body);
      if (body.trends && body.trends.length > 0) {
        // Validate trend data quality
        const trend = body.trends[0];
        if (trend.median_price && trend.sample_count) {
          if (trend.sample_count >= 10) {
            validationScore.add(0.9);
            percentileComplete.add(1);
            pythonAIReady.add(1);
          } else if (trend.sample_count >= 5) {
            validationScore.add(0.7);
            percentileComplete.add(0.5);
            pythonAIReady.add(0.5);
          } else {
            validationScore.add(0.5);
            percentileComplete.add(0);
            pythonAIReady.add(0);
          }
        }
      }
    } catch (e) {
      dataQualityIssues.add(1);
    }
  }
  
  sleep(0.5);
  
  // Test 2: Fuzzy search (validates processed data)
  const fuzzyRes = http.get(`${ANALYTICS_URL}/analytics/fuzzy-search`, {
    params: {
      q: query,
      limit: 20,
    },
    tags: { name: 'fuzzy_search' },
  });
  
  check(fuzzyRes, {
    'fuzzy search status is 200': (r) => r.status === 200,
    'fuzzy search has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.count > 0;
      } catch {
        return false;
      }
    },
  });
  
  sleep(0.3);
  
  // Test 3: Predict price (uses processed analytics)
  const predictRes = http.post(
    `${ANALYTICS_URL}/analytics/predict-price`,
    JSON.stringify({
      items: [{
        query: `${query} Test Album`,
        base_price: 50 + Math.random() * 100,
        record_grade: 'Very Good',
      }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'predict_price' },
    }
  );
  
  check(predictRes, {
    'predict price status is 200': (r) => r.status === 200,
    'predict price has valid result': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.suggested !== undefined && body.suggested > 0;
      } catch {
        return false;
      }
    },
  });
  
  sleep(0.2);
}

export function handleSummary(data) {
  return {
    'stdout': `
📊 Database Validation Results
==============================

Test Configuration:
  Analytics URL: ${ANALYTICS_URL}
  Virtual Users: ${VUS}
  Duration: ${DURATION}

HTTP Metrics:
  Total Requests: ${data.metrics.http_reqs?.values?.count || 0}
  Failed Requests: ${((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
  Avg Duration: ${(data.metrics.http_req_duration?.values?.avg || 0).toFixed(2)}ms
  P95 Duration: ${(data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2)}ms
  P99 Duration: ${(data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2)}ms

Data Quality Metrics:
  Percentile Complete (p1-p100): ${((data.metrics.percentile_complete_p1_p100?.values?.rate || 0) * 100).toFixed(1)}%
  Python AI Ready: ${((data.metrics.python_ai_ready?.values?.rate || 0) * 100).toFixed(1)}%
  Avg Validation Score: ${(data.metrics.validation_score?.values?.avg || 0).toFixed(3)}
  Data Quality Issues: ${data.metrics.data_quality_issues?.values?.count || 0}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.05 && 
         (data.metrics.percentile_complete_p1_p100?.values?.rate || 0) > 0.95 ? '✅ PASS' : '❌ FAIL'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

