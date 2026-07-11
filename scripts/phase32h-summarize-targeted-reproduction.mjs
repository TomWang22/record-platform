#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildPhase32hSummary,
  loadShardRows,
  writePhase32hSummary,
} from './lib/phase32h-targeted-summary.mjs';
import { resolvePhase32hRoot } from './lib/phase32h-targeted-reproduction-config.mjs';

function parseArgs(argv) {
  const opts = { in: resolvePhase32hRoot(), requirePass: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') opts.in = argv[++i];
    else if (argv[i] === '--require-pass') opts.requirePass = true;
    else if (argv[i] === '--json') opts.json = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = loadShardRows(opts.in);
  const summary = buildPhase32hSummary(opts.in, rows);
  writePhase32hSummary(opts.in, summary);
  if (opts.requirePass && summary.status !== 'PASS' && summary.status !== 'PASS_WITH_EXTREMES') {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
