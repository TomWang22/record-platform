#!/usr/bin/env node
/**
 * Phase 32D — launch controlled H1/H2/H3 timing attribution micro-soak shards.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MATRIX_OUT } from './lib/phase32d-controlled-matrix-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts/phase31-controlled-observability-matrix-runner.mjs');

function parseArgs(argv) {
  const opts = { out: DEFAULT_MATRIX_OUT, resume: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--no-resume') opts.resume = false;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) {
    throw new Error('phase32d output must be under /tmp');
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const children = [];
  for (const proto of ['h1', 'h2', 'h3']) {
    const shard = path.join(opts.out, `shard-${proto}`);
    fs.mkdirSync(shard, { recursive: true });
    const args = [
      RUNNER,
      '--protocol',
      proto,
      '--windows',
      '8',
      '--runs',
      '3',
      '--out',
      shard,
    ];
    if (opts.resume) args.push('--resume');
    const log = fs.openSync(path.join(opts.out, `runner-${proto}.log`), 'a');
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        T20_EVAL_RAG_PAUSE_SEC: process.env.T20_EVAL_RAG_PAUSE_SEC || '0.15',
      },
      stdio: ['ignore', log, log],
      detached: true,
    });
    child.unref();
    children.push({ proto, pid: child.pid });
    console.log(JSON.stringify({ started: proto, pid: child.pid, shard }));
  }
  console.log(JSON.stringify({ status: 'STARTED', out: opts.out, children }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
