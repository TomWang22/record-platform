#!/usr/bin/env node
import { buildDetailedGuardReport } from './lib/no-cursor-trailer-guard.mjs';
import { evaluateNoCursorTrailerGuard } from './lib/no-cursor-trailer-guard.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const opts = { ref: 'origin/main', range: undefined, allRefs: false, detailed: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ref') opts.ref = argv[++i];
    if (argv[i] === '--range') opts.range = argv[++i];
    if (argv[i] === '--all-refs') opts.allRefs = true;
    if (argv[i] === '--detailed') opts.detailed = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = opts.detailed
    ? buildDetailedGuardReport()
    : evaluateNoCursorTrailerGuard({
        ref: opts.ref,
        range: opts.range,
        includeAllRefs: opts.allRefs,
      });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
