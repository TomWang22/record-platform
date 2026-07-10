#!/usr/bin/env node
/**
 * Phase 32B — read-only latency outlier analyzer (output to /tmp only).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhase31MatrixRoot } from './lib/phase31-controlled-matrix-config.mjs';
import { analyzePhase32LatencyRca } from './lib/phase32-latency-rca-analyzer.mjs';

const DEFAULT_OUT = '/tmp/phase32-latency-rca';

function parseArgs(argv) {
  const opts = {
    in: resolvePhase31MatrixRoot(),
    out: DEFAULT_OUT,
    top: 50,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--top') opts.top = Number(argv[++i]);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { report, files } = analyzePhase32LatencyRca({
    matrixIn: opts.in,
    outDir: opts.out,
    topN: opts.top,
  });
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        phase: '32B',
        row_count: report.row_count,
        latency_rca_status: report.latency_rca_status,
        max_outlier_explained_from_jsonl: report.max_outlier_explained_from_jsonl,
        out_dir: opts.out,
        files,
      },
      null,
      2,
    ),
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
