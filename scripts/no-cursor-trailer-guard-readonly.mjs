#!/usr/bin/env node
/**
 * Read-only verifier: no Cursor/CursorAgent commit trailers (post-grandfather).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluateNoCursorTrailerGuard } from './lib/no-cursor-trailer-guard.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const opts = { ref: 'HEAD', strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ref') opts.ref = argv[++i];
    if (argv[i] === '--strict') opts.strict = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = evaluateNoCursorTrailerGuard({
    ref: opts.ref,
    strict: opts.strict,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
