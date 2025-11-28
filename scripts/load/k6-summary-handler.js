// k6 Summary Handler - Comprehensive Latency Metrics
// This script can be used as a teardown function to output detailed latency percentiles
// Usage: k6 run --summary-export=summary.json k6-mixed.js

import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

export function handleSummary(data) {
  // Extract comprehensive latency percentiles
  const extractPercentiles = (metric) => {
    if (!metric || !metric.values) return null;
    return {
      p50: metric.values['p(50)'] || null,
      p95: metric.values['p(95)'] || null,
      p99: metric.values['p(99)'] || null,
      p999: metric.values['p(99.9)'] || null,
      p9999: metric.values['p(99.99)'] || null,
      p99999: metric.values['p(99.999)'] || null,
      p999999: metric.values['p(99.9999)'] || null,
      p9999999: metric.values['p(99.99999)'] || null,
      p100: metric.values['p(100)'] || metric.values.max || null,
    };
  };

  // Build comprehensive latency report
  const latencyReport = {
    timestamp: new Date().toISOString(),
    metrics: {},
  };

  // Process all http_req_duration metrics
  for (const [key, metric] of Object.entries(data.metrics)) {
    if (key.startsWith('http_req_duration')) {
      const percentiles = extractPercentiles(metric);
      if (percentiles) {
        latencyReport.metrics[key] = {
          ...percentiles,
          avg: metric.values.avg || null,
          min: metric.values.min || null,
          max: metric.values.max || null,
          med: metric.values.med || null,
        };
      }
    }
  }

  // Output summary
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(latencyReport, null, 2),
    'summary.html': htmlReport(data),
  };
}

