#!/usr/bin/env node
/** Summarize Phase 31M targeted replay shards. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { DEFAULT_OUT } from './lib/phase31-targeted-replay-config.mjs';
import {
  compactTargetedSummary,
  loadTargetedShardRows,
  mergeAndSummarize,
} from './lib/phase31-targeted-replay-summary.mjs';

function parseArgs(argv) {
  const opts = { in: DEFAULT_OUT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--in') opts.in = argv[++i];
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summary = mergeAndSummarize(opts.in, { git_sha: gitSha() });
  if (opts.json) {
    console.log(JSON.stringify(compactTargetedSummary(summary)));
    return summary.status === 'PASS' ? 0 : summary.status === 'IN_PROGRESS' ? 2 : 1;
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary.status === 'PASS' ? 0 : summary.status === 'IN_PROGRESS' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
