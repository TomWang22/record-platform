#!/usr/bin/env node
/**
 * Phase 32H-R1-T — readonly prelaunch guard verifier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePrelaunchGuard } from './lib/phase32h-r1-prelaunch-guard.mjs';

function parseArgs(argv) {
  const opts = { smokeReport: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--smoke-report') {
      opts.smokeReport = JSON.parse(fs.readFileSync(argv[++i], 'utf8'));
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = evaluatePrelaunchGuard(opts);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
