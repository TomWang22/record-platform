#!/usr/bin/env node
/**
 * Phase 32F — read-only stall attribution analyzer CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_OUT,
  analyzePhase32fStallAttribution,
  assertPhase32fPass,
} from './lib/phase32f-stall-attribution-analyzer.mjs';

function parseArgs(argv) {
  const opts = {
    phase31: '/tmp/phase31d-r2-repaired-staging-long-soak',
    phase32d: '/tmp/phase32d-timing-attribution-micro-soak',
    phase32e: '/tmp/phase32e-slow-kpi-write-durability',
    out: DEFAULT_OUT,
    requirePass: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--phase31') opts.phase31 = argv[++i];
    else if (arg === '--phase32d') opts.phase32d = argv[++i];
    else if (arg === '--phase32e') opts.phase32e = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--require-pass') opts.requirePass = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = analyzePhase32fStallAttribution({
    phase31Root: opts.phase31,
    phase32dRoot: opts.phase32d,
    phase32eRoot: opts.phase32e,
    outDir: opts.out,
  });
  assertPhase32fPass(report);
  console.log(
    JSON.stringify(
      {
        status: report.status,
        phase: '32F',
        max_outlier_explained: report.summary.max_outlier_explained,
        out_dir: opts.out,
        files: report.files,
        next_required: report.summary.next_required,
      },
      null,
      2,
    ),
  );
  if (opts.requirePass && report.status !== 'PASS') return 1;
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
