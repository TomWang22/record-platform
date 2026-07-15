#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/phase33e-analytics-memory';

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
  const okA = run('evaluate-phase33e-market-analytics.mjs');
  const okM = run('evaluate-phase33e-memory.mjs');
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase33e-scenarios/inventory.json'), 'utf8'));
  const a = JSON.parse(fs.readFileSync(path.join(OUT, 'market-analytics-metrics.json'), 'utf8'));
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'memory-metrics.json'), 'utf8'));
  const summary = {
    ...inventory,
    analytics_pass_rate: a.pass_rate,
    memory_pass_rate: m.pass_rate,
    hard_violations: (a.hard_violations || 0) + (m.hard_violations || 0),
  };
  fs.writeFileSync(path.join(OUT, 'scenario-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT, 'privacy-isolation-results.json'),
    `${JSON.stringify({ cross_user_leakage: (a.cross_user_leakage || 0) + (m.cross_user_leakage || 0) }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'stale-fact-results.json'),
    `${JSON.stringify({ status: 'evaluated_via_scenarios' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'methodology-validation-results.json'),
    `${JSON.stringify({ status: 'methodology_contract_present' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'confidence-calibration.json'),
    `${JSON.stringify({ note: 'deterministic_confidence_factors_only' }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'schema-validation-results.json'),
    `${JSON.stringify({ analytics_schema_invalid: a.schema_invalid_outputs, memory_schema_invalid: m.schema_invalid_outputs }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'owner-approval-package.json'),
    `${JSON.stringify({ phase: '33E', status: okA && okM ? 'FIXTURE_PASS_NOT_PRODUCTION' : 'FAIL', production_authorized: false }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'coverage-report.json'),
    `${JSON.stringify({
      note: 'python-ai app/ai coverage enforced separately via scripts/coverage/*',
      threshold_changes_allowed: 0,
      required_lines_pct: 90,
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT, 'final-report.md'),
    `# Phase 33E Offline Evaluation\n\n- analytics pass rate: ${a.pass_rate}\n- memory pass rate: ${m.pass_rate}\n- hard violations: ${summary.hard_violations}\n- production: NOT APPROVED\n- durable private memory: NOT AUTHORIZED\n- Phase 33F live gauntlet: NOT LAUNCHED\n`,
  );
  if (!(okA && okM)) process.exit(1);
}

main();
