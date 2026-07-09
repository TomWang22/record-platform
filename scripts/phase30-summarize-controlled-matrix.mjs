#!/usr/bin/env node
/**
 * Phase 30D — merge shard JSONL (+ optional retry overrides) and emit summary artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllShardRows } from './phase30-extract-controlled-matrix-failures.mjs';
import { writeMatrixArtifacts, loadJsonl } from './lib/phase30-controlled-matrix-summary.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { in: '/tmp/phase30-controlled-staging-matrix', out: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--json') opts.json = true;
  }
  if (!opts.out) opts.out = opts.in;
  return opts;
}

function mergeRows(inDir) {
  const { rows: shardRows } = loadAllShardRows(inDir);
  const retryPath = path.join(inDir, 'phase30-retry-failures.jsonl');
  const retryRows = loadJsonl(retryPath);
  const byProbe = new Map();
  for (const row of shardRows) {
    const key = [row.matrix_protocol, row.window, row.run, row.case_id, row.user_uid_hash].join('|');
    byProbe.set(key, row);
  }
  for (const row of retryRows) {
    const key = [
      row.matrix_protocol,
      row.window,
      row.run,
      row.case_id,
      row.user_uid_hash,
    ].join('|');
    byProbe.set(key, { ...row, retry_override: true });
  }
  return [...byProbe.values()].sort((a, b) => {
    const protoOrder = { h1: 0, h2: 1, h3: 2 };
    const pd = (protoOrder[a.matrix_protocol] ?? 9) - (protoOrder[b.matrix_protocol] ?? 9);
    return pd !== 0 ? pd : a.probe_id - b.probe_id;
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = mergeRows(opts.in);
  const summary = writeMatrixArtifacts(opts.out, rows, {
    git_sha: gitSha(),
    merged_from_shards: true,
    retry_overrides: loadJsonl(path.join(opts.in, 'phase30-retry-failures.jsonl')).length,
  });
  if (opts.json) {
    const total = rows.length;
    const per = summary.per_protocol_counts || {};
    const lat = Object.fromEntries((summary.latency_by_protocol || []).map((r) => [r.protocol, r]));
    const compact = {
      total,
      status: summary.status,
      matrix_total: summary.matrix_total,
      http200: summary.http200,
      per_protocol: per,
      fallback: summary.fallback_count,
      wrong_protocol: summary.wrong_protocol_count,
      wrong_gate: summary.wrong_gate_count,
      response_pass_rate: summary.response_pass_rate,
      sentiment_pass_rate: summary.sentiment_pass_rate,
      red_team_safety_pass_rate: summary.red_team_safety_pass_rate,
      leakage_failures: summary.leakage_failures,
      latency_h1: lat['HTTP/1.1']
        ? { p50: lat['HTTP/1.1'].p50, p95: lat['HTTP/1.1'].p95, p99: lat['HTTP/1.1'].p99, max: lat['HTTP/1.1'].max }
        : null,
      latency_h2: lat['HTTP/2']
        ? { p50: lat['HTTP/2'].p50, p95: lat['HTTP/2'].p95, p99: lat['HTTP/2'].p99, max: lat['HTTP/2'].max }
        : null,
      latency_h3: lat['HTTP/3']
        ? { p50: lat['HTTP/3'].p50, p95: lat['HTTP/3'].p95, p99: lat['HTTP/3'].p99, max: lat['HTTP/3'].max }
        : null,
    };
    console.log(JSON.stringify(compact));
  } else {
    process.stderr.write(
      `phase30 summarize: ${summary.matrix_total} status=${summary.status} wrong_gate=${summary.wrong_gate_count} response_pass=${(summary.response_pass_rate * 100).toFixed(1)}%\n`,
    );
    console.log(JSON.stringify(summary, null, 2));
  }
  return summary.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { mergeRows };
