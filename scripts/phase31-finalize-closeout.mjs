#!/usr/bin/env node
/**
 * Merge matrix shards, summarize, generate /tmp KPI report, run rollback drill.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhase31MatrixRoot } from './lib/phase31-controlled-matrix-config.mjs';
import { writeMatrixArtifacts, MATRIX_TARGET } from './lib/phase31-controlled-matrix-summary.mjs';
import { mergeRows } from './phase31-summarize-controlled-matrix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outBase = resolvePhase31MatrixRoot();

function mergeShardsWithRetryOverrides() {
  const rows = mergeRows(outBase);
  const merged = path.join(outBase, 'phase31-matrix.jsonl');
  fs.mkdirSync(outBase, { recursive: true });
  fs.writeFileSync(merged, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return rows;
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const rows = mergeShardsWithRetryOverrides();
const summary = writeMatrixArtifacts(outBase, rows, {
  git_sha: run('git', ['rev-parse', 'HEAD']).trim(),
});
run('node', [path.join(repoRoot, 'scripts/phase31-generate-kpi-report-readonly.mjs'), '/tmp/phase31-kpi-report']);
const reportDir = path.join(outBase, 'phase31-kpi-report');
fs.mkdirSync(reportDir, { recursive: true });
spawnSync('cp', ['-R', '/tmp/phase31-kpi-report/.', reportDir], { stdio: 'inherit' });
run(path.join(repoRoot, 'services/python-ai-service/.venv/bin/python'), [
  path.join(repoRoot, 'scripts/phase31-disable-switch-rollback-drill.py'),
]);

const result = {
  matrix_total: summary.matrix_total,
  status: summary.status,
  per_protocol: summary.per_protocol_counts,
  fallback_count: summary.fallback_count,
  wrong_protocol_count: summary.wrong_protocol_count,
  wrong_gate_count: summary.wrong_gate_count,
  leakage_failures: summary.leakage_failures,
  latency_by_protocol: summary.latency_by_protocol,
  target: MATRIX_TARGET.total,
};
console.log(JSON.stringify(result, null, 2));
process.exit(summary.status === 'PASS' ? 0 : 1);
