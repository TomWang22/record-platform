#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/phase33d-negotiation-recommendations';

function run(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '../..'),
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return r.status === 0;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const okNeg = run('evaluate-phase33d-negotiation.mjs');
  const okRec = run('evaluate-phase33d-recommendations.mjs');
  const inventory = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'phase33d-scenarios/inventory.json'), 'utf8'),
  );
  const neg = JSON.parse(fs.readFileSync(path.join(OUT, 'negotiation-metrics.json'), 'utf8'));
  const rec = JSON.parse(fs.readFileSync(path.join(OUT, 'recommendation-metrics.json'), 'utf8'));
  const summary = {
    negotiation: inventory.negotiation,
    recommendations: inventory.recommendations,
    total: inventory.total,
    multi_turn_sessions: inventory.multi_turn_sessions,
    privacy_adversarial: inventory.privacy_adversarial,
    negotiation_pass_rate: neg.pass_rate,
    recommendation_pass_rate: rec.pass_rate,
    hard_violations: (neg.hard_violations || 0) + (rec.hard_violations || 0),
  };
  fs.writeFileSync(path.join(OUT, 'scenario-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT, 'privacy-isolation-results.json'),
    `${JSON.stringify(
      {
        cross_user_leakage: (neg.cross_user_leakage || 0) + (rec.cross_user_leakage || 0),
        privacy_leakage: rec.privacy_leakage || 0,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'safety-refusal-results.json'),
    `${JSON.stringify(
      {
        auto_send_violations: neg.auto_send_violations || 0,
        fabricated_leverage: neg.fabricated_leverage || 0,
        impersonation_violations: neg.impersonation_violations || 0,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'grounding-results.json'),
    `${JSON.stringify({ status: 'fixture_grounded', retrieval_mode: 'keyword_metadata' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'schema-validation-results.json'),
    `${JSON.stringify(
      {
        negotiation_schema_invalid: neg.schema_invalid_outputs || 0,
        recommendation_schema_invalid: rec.schema_invalid_outputs || 0,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'confidence-calibration.json'),
    `${JSON.stringify({ note: 'deterministic_confidence_factors_only' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'owner-approval-package.json'),
    `${JSON.stringify(
      {
        phase: '33D',
        status: okNeg && okRec ? 'FIXTURE_PASS_NOT_PRODUCTION' : 'FAIL',
        production_authorized: false,
        automatic_send_allowed: false,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'final-report.md'),
    `# Phase 33D Offline Evaluation\n\n- negotiation pass rate: ${neg.pass_rate}\n- recommendation pass rate: ${rec.pass_rate}\n- hard violations: ${summary.hard_violations}\n- production: NOT APPROVED\n- automatic send: DISABLED\n`,
  );
  if (!(okNeg && okRec)) process.exit(1);
}

main();
