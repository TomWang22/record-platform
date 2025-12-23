#!/usr/bin/env node
/**
 * Calculate granular percentiles from k6 JSON results
 * Calculates: p100, p99, p99.9, p99.99, p99.999, p99.9999, p99.99999, p99.999999
 */

const fs = require('fs');
const path = require('path');

// Percentiles to calculate (granular breakdown)
const PERCENTILES = [
  100,       // p100 (max)
  99,        // p99
  99.9,      // p99.9
  99.99,     // p99.99
  99.999,    // p99.999
  99.9999,   // p99.9999
  99.99999,  // p99.99999
  99.999999, // p99.999999
];

// Metrics to analyze
const METRICS = [
  'register_latency',
  'login_latency',
  'validate_latency',
  'refresh_latency',
  'logout_latency',
  'http_req_duration',
];

function calculatePercentile(values, percentile) {
  if (!values || values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function extractValues(data, metricName) {
  const values = [];
  
  // Try to find the metric in different locations
  if (data.metrics && data.metrics[metricName]) {
    const metric = data.metrics[metricName];
    
    // If it has values array (Trend metric)
    if (metric.values && Array.isArray(metric.values)) {
      return metric.values;
    }
    
    // If it has data points
    if (metric.data && Array.isArray(metric.data)) {
      return metric.data.map(d => d.value || d);
    }
  }
  
  // Try to extract from root level
  if (data[metricName]) {
    if (Array.isArray(data[metricName])) {
      return data[metricName];
    }
  }
  
  return values;
}

function analyzeMetric(data, metricName) {
  const values = extractValues(data, metricName);
  
  if (values.length === 0) {
    return null;
  }
  
  const results = {
    metric: metricName,
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    percentiles: {},
  };
  
  // Calculate all percentiles
  for (const p of PERCENTILES) {
    const value = calculatePercentile(values, p);
    results.percentiles[`p${p}`] = value;
  }
  
  return results;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node calculate-granular-percentiles.js <k6-results.json>');
    process.exit(1);
  }
  
  const inputFile = args[0];
  
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }
  
  let data;
  try {
    const content = fs.readFileSync(inputFile, 'utf8');
    data = JSON.parse(content);
  } catch (err) {
    console.error(`Error parsing JSON: ${err.message}`);
    process.exit(1);
  }
  
  console.log('=== Granular Percentile Analysis ===\n');
  
  const results = {};
  
  for (const metric of METRICS) {
    const analysis = analyzeMetric(data, metric);
    if (analysis) {
      results[metric] = analysis;
    }
  }
  
  // Print results
  for (const [metricName, analysis] of Object.entries(results)) {
    console.log(`\n${metricName.toUpperCase()}:`);
    console.log(`  Count: ${analysis.count}`);
    console.log(`  Min: ${analysis.min.toFixed(2)}ms`);
    console.log(`  Max: ${analysis.max.toFixed(2)}ms (p100)`);
    console.log(`  Avg: ${analysis.avg.toFixed(2)}ms`);
    console.log(`  Percentiles:`);
    for (const p of PERCENTILES) {
      const key = `p${p}`;
      const value = analysis.percentiles[key];
      if (value !== null && value !== undefined) {
        console.log(`    ${key.padEnd(12)}: ${value.toFixed(2)}ms`);
      }
    }
  }
  
  // Generate JSON output
  const outputFile = inputFile.replace('.json', '-percentiles.json');
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to: ${outputFile}`);
  
  // Generate markdown report
  const mdFile = inputFile.replace('.json', '-percentiles.md');
  let md = `# Granular Percentile Analysis\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  
  for (const [metricName, analysis] of Object.entries(results)) {
    md += `## ${metricName.toUpperCase()}\n\n`;
    md += `- **Count:** ${analysis.count}\n`;
    md += `- **Min:** ${analysis.min.toFixed(2)}ms\n`;
    md += `- **Max (p100):** ${analysis.max.toFixed(2)}ms\n`;
    md += `- **Average:** ${analysis.avg.toFixed(2)}ms\n\n`;
    md += `### Percentiles\n\n`;
    md += `| Percentile | Latency (ms) |\n`;
    md += `|------------|-------------|\n`;
    for (const p of PERCENTILES) {
      const key = `p${p}`;
      const value = analysis.percentiles[key];
      if (value !== null && value !== undefined) {
        md += `| ${key} | ${value.toFixed(2)} |\n`;
      }
    }
    md += `\n`;
  }
  
  fs.writeFileSync(mdFile, md);
  console.log(`✅ Markdown report saved to: ${mdFile}`);
}

main();

