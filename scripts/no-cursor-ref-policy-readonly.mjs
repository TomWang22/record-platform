#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listForbiddenRetainedRefs } from './lib/retained-ref-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}

function main() {
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  const forbidden = listForbiddenRetainedRefs(refs);
  const report = {
    guard: 'retained-ref-policy',
    status: forbidden.length === 0 ? 'PASS' : 'FAIL',
    retained_refs_scanned: refs.length,
    forbidden_refs: forbidden,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exit(2);
}

main();
