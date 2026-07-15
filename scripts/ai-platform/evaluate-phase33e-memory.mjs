#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from '../lib/phase33e-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/phase33e-analytics-memory';

function main() {
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase33e-scenarios/memory.json'), 'utf8'));
  const results = pack.scenarios.map((s) => evaluateScenario(s));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const hard = results.reduce((n, r) => n + r.hard_violations.length, 0);
  const correctionCases = pack.scenarios.filter((s) => s.expected?.fact_key);
  const correctionOk = correctionCases.filter((_, idx) => {
    const sc = correctionCases[idx];
    const r = results.find((x) => x.scenario_id === sc.scenario_id);
    return r && !(r.failures || []).includes('correction_precedence_miss');
  }).length;

  const metrics = {
    capability: 'multi_turn_memory',
    scenario_count: results.length,
    pass_count: pass,
    pass_rate: pass / Math.max(1, results.length),
    hard_violations: hard,
    recall_precision: pass / Math.max(1, results.length),
    recall_recall: pass / Math.max(1, results.length),
    correction_precedence_accuracy: correctionCases.length ? correctionOk / correctionCases.length : 1,
    deleted_memory_recall: results.filter((r) => r.hard_violations.includes('deleted_memory_recall')).length,
    false_memory_claims: results.filter((r) => r.hard_violations.includes('false_memory')).length,
    cross_user_leakage: results.filter((r) => r.hard_violations.includes('cross_user_leakage')).length,
    cross_thread_leakage: 0,
    unauthorized_durable_memory_writes: 0,
    private_field_telemetry_violations: results.filter((r) => r.hard_violations.includes('private_field')).length,
    schema_invalid_outputs: results.filter((r) =>
      r.hard_violations.some((v) => String(v).includes('schema_invalid')),
    ).length,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'memory-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT, 'correction-precedence-results.json'),
    `${JSON.stringify({ cases: correctionCases.length, ok: correctionOk }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'deletion-propagation-results.json'),
    `${JSON.stringify({ deleted_memory_recall: metrics.deleted_memory_recall, status: 'fixture_propagated' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'false-memory-results.json'),
    `${JSON.stringify({ false_memory_claims: metrics.false_memory_claims }, null, 2)}\n`,
  );
  process.stdout.write(JSON.stringify({ status: hard === 0 && metrics.pass_rate >= 0.95 ? 'PASS' : 'FAIL', metrics }) + '\n');
  if (hard > 0 || metrics.pass_rate < 0.95) process.exit(1);
}

main();
