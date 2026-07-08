#!/usr/bin/env node
/**
 * Phase 28D — merge shard JSONL (+ optional retry overrides) and emit summary artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllShardRows } from './phase28-extract-controlled-matrix-failures.mjs';
import { writeMatrixArtifacts, loadJsonl } from './lib/phase28-controlled-matrix-summary.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { in: '/tmp/phase28-controlled-observability-matrix', out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
  }
  if (!opts.out) opts.out = opts.in;
  return opts;
}

function mergeRows(inDir) {
  const { rows: shardRows } = loadAllShardRows(inDir);
  const retryPath = path.join(inDir, 'phase28-retry-failures.jsonl');
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
    retry_overrides: loadJsonl(path.join(opts.in, 'phase28-retry-failures.jsonl')).length,
  });
  process.stderr.write(
    `phase28 summarize: ${summary.matrix_total} status=${summary.status} wrong_gate=${summary.wrong_gate_count} response_pass=${(summary.response_pass_rate * 100).toFixed(1)}%\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  return summary.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { mergeRows };
