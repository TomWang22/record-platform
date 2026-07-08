#!/usr/bin/env node
/**
 * Merge matrix shards, summarize, generate /tmp KPI report, run rollback drill.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJsonl, writeMatrixArtifacts, summarizeMatrixRows, MATRIX_TARGET } from './lib/phase28-controlled-matrix-summary.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outBase = process.env.PHASE28_MATRIX_OUT || '/tmp/phase28-controlled-observability-matrix';
const shards = ['h1', 'h2', 'h3'];

function mergeShards() {
  const rows = [];
  for (const shard of shards) {
    const jsonl = path.join(outBase, `shard-${shard}`, 'phase28-matrix.jsonl');
    if (fs.existsSync(jsonl)) rows.push(...loadJsonl(jsonl));
  }
  const merged = path.join(outBase, 'phase28-matrix.jsonl');
  fs.mkdirSync(outBase, { recursive: true });
  fs.writeFileSync(merged, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return rows;
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const rows = mergeShards();
const summary = writeMatrixArtifacts(outBase, rows, {
  git_sha: run('git', ['rev-parse', 'HEAD']).trim(),
});
run('node', [path.join(repoRoot, 'scripts/phase28-generate-kpi-report-readonly.mjs'), '/tmp/phase28-kpi-report']);
const reportDir = path.join(outBase, 'phase28-kpi-report');
fs.mkdirSync(reportDir, { recursive: true });
spawnSync('cp', ['-R', '/tmp/phase28-kpi-report/.', reportDir], { stdio: 'inherit' });
run(path.join(repoRoot, 'services/python-ai-service/.venv/bin/python'), [
  path.join(repoRoot, 'scripts/phase28-disable-switch-rollback-drill.py'),
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
