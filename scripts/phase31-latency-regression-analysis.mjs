#!/usr/bin/env node
/**
 * Phase 31G — latency/regression analysis vs Phase 30 staging soak baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRows } from './phase31-summarize-controlled-matrix.mjs';
import { writeMatrixArtifacts } from './lib/phase31-controlled-matrix-summary.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHASE30_BASELINE = '/tmp/phase30-controlled-staging-matrix/phase30-summary.json';

function parseArgs(argv) {
  const opts = {
    in: '/tmp/phase31-staging-long-soak-matrix',
    out: '/tmp/phase31-staging-long-soak-matrix/phase31-latency-regression.json',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
  }
  return opts;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latencyRow(row) {
  if (!row) return null;
  return { p50: row.p50, p95: row.p95, p99: row.p99, max: row.max, count: row.count };
}

function deltaPct(current, baseline, field) {
  if (current == null || baseline == null || baseline === 0) return null;
  return Number((((current - baseline) / baseline) * 100).toFixed(2));
}

function compareProtocol(currentRows, baselineRows) {
  const byProto = Object.fromEntries((currentRows || []).map((r) => [r.protocol, r]));
  const baseByProto = Object.fromEntries((baselineRows || []).map((r) => [r.protocol, r]));
  const out = {};
  for (const proto of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
    const cur = byProto[proto];
    const base = baseByProto[proto];
    out[proto] = {
      current: latencyRow(cur),
      baseline: latencyRow(base),
      delta_pct: {
        p50: deltaPct(cur?.p50, base?.p50, 'p50'),
        p95: deltaPct(cur?.p95, base?.p95, 'p95'),
        p99: deltaPct(cur?.p99, base?.p99, 'p99'),
        max: deltaPct(cur?.max, base?.max, 'max'),
      },
      regression_flag:
        cur?.p95 != null && base?.p95 != null ? cur.p95 > base.p95 * 1.15 : null,
    };
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = mergeRows(opts.in);
  const summary = writeMatrixArtifacts(opts.in, rows, {
    git_sha: gitSha(),
    merged_from_shards: true,
  });
  const baseline = loadJson(PHASE30_BASELINE);
  const report = {
    generated_at: new Date().toISOString(),
    phase: '31G',
    matrix_total: summary.matrix_total,
    status: summary.status,
    baseline_path: PHASE30_BASELINE,
    baseline_available: Boolean(baseline),
    latency_by_protocol: compareProtocol(summary.latency_by_protocol, baseline?.latency_by_protocol),
    latency_by_case: summary.latency_by_case,
    latency_by_gate: summary.latency_by_gate,
    latency_by_user_class: summary.latency_by_user_class,
    outliers_top20_path: path.join(opts.in, 'phase31-latency-outliers-top20.json'),
    notes: [
      'Phase 31 evidence is separate from Phase 30 25920/25920 staging soak',
      'regression_flag uses p95 > 115% of Phase 30 baseline per protocol',
    ],
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: summary.status, out: opts.out }, null, 2));
  return summary.status === 'PASS' ? 0 : summary.status === 'IN_PROGRESS' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
