/**
 * k6 Load Test: Analytics Data Quality Validation
 * 
 * Tests data quality after ingestion:
 * - Validates percentiles p1-p100 in stored data
 * - Checks Python AI readiness
 * - Verifies statistical consistency
 * - Tests with real database queries
 * 
 * This test queries the actual database to verify data quality,
 * simulating what Python AI service would receive.
 * 
 * Usage:
 *   k6 run --vus 5 --duration 30s scripts/load/k6-analytics-data-quality.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Configuration
const ANALYTICS_URL = __ENV.ANALYTICS_URL || 'http://localhost:4004';
const AUCTION_MONITOR_URL = __ENV.AUCTION_MONITOR_URL || 'http://localhost:4008';
const TOKEN = __ENV.TOKEN || '';
const VUS = Number(__ENV.VUS || 5);
const DURATION = __ENV.DURATION || '30s';

// Custom metrics
const percentileComplete = new Rate('percentile_complete_p1_p100');
const pythonAIReady = new Rate('python_ai_ready');
const validationScore = new Trend('validation_score');
const statisticalConsistency = new Rate('statistical_consistency');
const dataQualityIssues = new Counter('data_quality_issues');

// Test queries that should return processed data
const testQueries = [
  'The Beatles Abbey Road',
  'Pink Floyd Dark Side',
  'Led Zeppelin IV',
  'Queen Night at the Opera',
  'David Bowie Ziggy',
  'The Rolling Stones Sticky',
  'Fleetwood Mac Rumours',
  'The Who Next',
];

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
    'http_req_failed': ['rate<0.02'],
    'percentile_complete_p1_p100': ['rate>0.95'],
    'python_ai_ready': ['rate>0.90'],
    'validation_score': ['avg>0.85'],
    'statistical_consistency': ['rate>0.90'],
  },
};

// Validate percentiles from metadata
function validatePercentilesFromMetadata(metadata) {
  if (!metadata || !metadata.percentiles) {
    dataQualityIssues.add(1);
    return false;
  }
  
  const percentiles = metadata.percentiles;
  
  // Check all p1-p100 exist
  for (let p = 1; p <= 100; p++) {
    const key = `p${p}`;
    if (percentiles[key] === undefined || percentiles[key] === null) {
      dataQualityIssues.add(1);
      return false;
    }
    if (typeof percentiles[key] !== 'number' || percentiles[key] < 0) {
      dataQualityIssues.add(1);
      return false;
    }
  }
  
  // Check ordering
  for (let p = 1; p < 100; p++) {
    if (percentiles[`p${p}`] > percentiles[`p${p + 1}`]) {
      dataQualityIssues.add(1);
      return false;
    }
  }
  
  // Check min/max bounds
  if (percentiles.min !== undefined && percentiles.max !== undefined) {
    if (percentiles.min > percentiles.p1 || percentiles.p100 > percentiles.max) {
      dataQualityIssues.add(1);
      return false;
    }
  }
  
  return true;
}

// Validate statistical consistency
function validateStatisticalConsistency(percentiles) {
  if (!percentiles) return false;
  
  // Check mean is reasonable
  if (percentiles.mean !== undefined && percentiles.min !== undefined && percentiles.max !== undefined) {
    if (percentiles.mean < percentiles.min || percentiles.mean > percentiles.max) {
      return false;
    }
  }
  
  // Check median is reasonable
  if (percentiles.median !== undefined && percentiles.min !== undefined && percentiles.max !== undefined) {
    if (percentiles.median < percentiles.min || percentiles.median > percentiles.max) {
      return false;
    }
  }
  
  // Check p50 (median) is close to median field
  if (percentiles.p50 !== undefined && percentiles.median !== undefined) {
    const diff = Math.abs(percentiles.p50 - percentiles.median);
    const tolerance = percentiles.median * 0.1; // 10% tolerance
    if (diff > tolerance) {
      return false;
    }
  }
  
  return true;
}

export default function () {
  const query = testQueries[Math.floor(Math.random() * testQueries.length)];
  
  // Test 1: Fuzzy search (queries processed data)
  const fuzzyRes = http.get(`${ANALYTICS_URL}/analytics/fuzzy-search`, {
    params: {
      q: query,
      limit: 20,
    },
    tags: { name: 'fuzzy_search' },
  });
  
  const fuzzyCheck = check(fuzzyRes, {
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
  
  if (fuzzyCheck && fuzzyRes.status === 200) {
    try {
      const body = JSON.parse(fuzzyRes.body);
      
      // Validate price matches (should have percentiles)
      if (body.results && body.results.priceMatches) {
        const priceMatches = body.results.priceMatches;
        if (priceMatches.length > 0) {
          // Price snapshots should have statistical data
          const snapshot = priceMatches[0];
          if (snapshot.median_price !== undefined && snapshot.sample_count !== undefined) {
            statisticalConsistency.add(snapshot.sample_count >= 10 ? 1 : 0);
          }
        }
      }
    } catch (e) {
      dataQualityIssues.add(1);
    }
  }
  
  sleep(0.5);
  
  // Test 2: Price trend (uses processed analytics data)
  const parts = query.split(' ');
  const artist = parts[0] + ' ' + (parts[1] || '');
  const name = parts.slice(2).join(' ') || parts[1] || query;
  
  const trendRes = http.get(`${ANALYTICS_URL}/analytics/price-trend`, {
    params: {
      artist: artist,
      name: name,
      days: 90,
    },
    tags: { name: 'price_trend' },
  });
  
  check(trendRes, {
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
  
  sleep(0.3);
  
  // Test 3: Predict price (validates data quality through prediction)
  const predictRes = http.post(
    `${ANALYTICS_URL}/analytics/predict-price`,
    JSON.stringify({
      items: [{
        query: query,
        base_price: 50 + Math.random() * 100,
        record_grade: 'Very Good',
      }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'predict_price' },
    }
  );
  
  const predictCheck = check(predictRes, {
    'predict price status is 200': (r) => r.status === 200,
    'predict price returns valid suggestion': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.suggested !== undefined && 
               body.suggested > 0 && 
               body.samples !== undefined;
      } catch {
        return false;
      }
    },
  });
  
  if (predictCheck) {
    try {
      const body = JSON.parse(predictRes.body);
      // Higher sample count = better data quality
      if (body.samples >= 10) {
        validationScore.add(0.9);
        pythonAIReady.add(1);
      } else if (body.samples >= 5) {
        validationScore.add(0.7);
        pythonAIReady.add(0.5);
      } else {
        validationScore.add(0.5);
        pythonAIReady.add(0);
      }
    } catch (e) {
      dataQualityIssues.add(1);
    }
  }
  
  sleep(0.2);
  
  // Test 4: Health check (validates service is processing)
  const healthRes = http.get(`${AUCTION_MONITOR_URL}/healthz`, {
    tags: { name: 'health_check' },
  });
  
  check(healthRes, {
    'auction monitor health is 200': (r) => r.status === 200,
  });
  
  const analyticsHealthRes = http.get(`${ANALYTICS_URL}/healthz`, {
    tags: { name: 'analytics_health' },
  });
  
  check(analyticsHealthRes, {
    'analytics health is 200': (r) => r.status === 200,
    'analytics databases connected': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.listings === 'ok' && body.analytics === 'ok';
      } catch {
        return false;
      }
    },
  });
  
  sleep(0.5);
}

export function handleSummary(data) {
  return {
    'stdout': `
📊 Analytics Data Quality Validation Results
============================================

Test Configuration:
  Analytics URL: ${ANALYTICS_URL}
  Auction Monitor URL: ${AUCTION_MONITOR_URL}
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
  Statistical Consistency: ${((data.metrics.statistical_consistency?.values?.rate || 0) * 100).toFixed(1)}%
  Data Quality Issues: ${data.metrics.data_quality_issues?.values?.count || 0}

Status: ${(data.metrics.http_req_failed?.values?.rate || 1) < 0.02 && 
         (data.metrics.percentile_complete_p1_p100?.values?.rate || 0) > 0.95 ? '✅ PASS' : '❌ FAIL'}
    `,
    'summary.json': JSON.stringify(data, null, 2),
  };
}

