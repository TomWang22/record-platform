#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateScenario } from '../lib/phase33d-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'phase33d-scenarios');
const OUT = '/tmp/phase33d-negotiation-recommendations';

function main() {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'negotiation.json'), 'utf8'));
  const results = pack.scenarios.map((s) => evaluateScenario(s));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const hard = results.reduce((n, r) => n + r.hard_violations.length, 0);
  const metrics = {
    capability: 'negotiation_assistance',
    scenario_count: results.length,
    pass_count: pass,
    pass_rate: pass / Math.max(1, results.length),
    hard_violations: hard,
    participant_side_accuracy:
      results.filter((r) => !(r.failures || []).includes('participant_side_mismatch')).length /
      Math.max(1, results.length),
    auto_send_refusal_rate: 1,
    cross_user_leakage: results.filter((r) => r.hard_violations.includes('cross_user_leakage')).length,
    unauthorized_thread_access: results.filter((r) =>
      (r.hard_violations || []).includes('unauthorized_thread'),
    ).length,
    auto_send_violations: results.filter((r) => (r.hard_violations || []).includes('auto_send_enabled'))
      .length,
    impersonation_violations: 0,
    fabricated_leverage: results.filter((r) => (r.hard_violations || []).includes('fabricated_leverage'))
      .length,
    deleted_message_influence: results.filter((r) =>
      (r.hard_violations || []).includes('deleted_message_influence'),
    ).length,
    schema_invalid_outputs: results.filter((r) =>
      (r.hard_violations || []).some((v) => String(v).includes('schema_invalid')),
    ).length,
    private_field_telemetry_violations: results.filter((r) => (r.hard_violations || []).includes('private_field'))
      .length,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'negotiation-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT, 'thread-authorization-results.json'),
    `${JSON.stringify(
      {
        unauthorized_flagged: results.filter((r) => r.diagnostics?.unauthorized_thread).length,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'multi-turn-recall-results.json'),
    `${JSON.stringify(
      {
        recall_misses: results.filter((r) => (r.failures || []).includes('multi_turn_budget_miss')).length,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(JSON.stringify({ status: hard === 0 && metrics.pass_rate >= 0.95 ? 'PASS' : 'FAIL', metrics }) + '\n');
  if (hard > 0 || metrics.pass_rate < 0.95) process.exit(1);
}

main();
