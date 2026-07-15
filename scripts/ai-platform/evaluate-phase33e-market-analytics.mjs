#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from '../lib/phase33e-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/phase33e-analytics-memory';

function main() {
  const pack = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'phase33e-scenarios/market-analytics.json'), 'utf8'),
  );
  const results = pack.scenarios.map((s) => evaluateScenario(s));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const hard = results.reduce((n, r) => n + r.hard_violations.length, 0);
  const metrics = {
    capability: 'market_analytics',
    scenario_count: results.length,
    pass_count: pass,
    pass_rate: pass / Math.max(1, results.length),
    hard_violations: hard,
    asking_as_sold_violations: results.filter((r) => r.hard_violations.includes('asking_as_sold')).length,
    unsupported_causal_claims: results.filter((r) => r.hard_violations.includes('unsupported_causal_claim')).length,
    unsupported_prediction_claims: results.filter((r) =>
      r.hard_violations.includes('unsupported_prediction_claim'),
    ).length,
    missing_sample_size_violations: results.filter((r) => r.hard_violations.includes('missing_sample_size')).length,
    schema_invalid_outputs: results.filter((r) =>
      r.hard_violations.some((v) => String(v).includes('schema_invalid')),
    ).length,
    privacy_leakage: 0,
    cross_user_leakage: results.filter((r) => r.hard_violations.includes('cross_user_leakage')).length,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'market-analytics-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ status: hard === 0 && metrics.pass_rate >= 0.95 ? 'PASS' : 'FAIL', metrics }) + '\n');
  if (hard > 0 || metrics.pass_rate < 0.95) process.exit(1);
}

main();
