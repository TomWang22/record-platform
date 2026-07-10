#!/usr/bin/env node
/**
 * Phase 32E — run baseline / slow-write / failing-write durability micro-soaks.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MATRIX_OUT,
  MATRIX_TARGET,
  MODES,
  kpiInjectionEnv,
} from './lib/phase32e-controlled-matrix-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts/phase31-controlled-observability-matrix-runner.mjs');
const PER_SHARD = MATRIX_TARGET.perProtocol;

function parseArgs(argv) {
  const opts = { out: DEFAULT_MATRIX_OUT, modes: Object.keys(MODES) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--mode') opts.modes = [argv[++i]];
  }
  return opts;
}

function setK8sInjectionEnv(injection) {
  const args = [
    'set',
    'env',
    'deployment/python-ai-service',
    '-n',
    'record-platform',
    `AI_KPI_TEST_INJECT_WRITE_DELAY_MS=${injection.AI_KPI_TEST_INJECT_WRITE_DELAY_MS}`,
    `AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE=${injection.AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE}`,
    `AI_KPI_TEST_INJECT_TIMEOUT_MS=${injection.AI_KPI_TEST_INJECT_TIMEOUT_MS}`,
    `AI_KPI_TEST_INJECT_DB_UNAVAILABLE=${injection.AI_KPI_TEST_INJECT_DB_UNAVAILABLE}`,
  ];
  const set = spawnSync('kubectl', args, { encoding: 'utf8' });
  if (set.status !== 0) {
    throw new Error(`kubectl set env failed: ${set.stderr || set.stdout}`);
  }
  const rollout = spawnSync(
    'kubectl',
    ['-n', 'record-platform', 'rollout', 'status', 'deployment/python-ai-service', '--timeout=300s'],
    { encoding: 'utf8' },
  );
  if (rollout.status !== 0) {
    throw new Error(`rollout failed: ${rollout.stderr || rollout.stdout}`);
  }
}

function shardCount(modeDir, proto) {
  const jsonl = path.join(modeDir, `shard-${proto}`, 'phase31-matrix.jsonl');
  if (!fs.existsSync(jsonl)) return 0;
  return fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).length;
}

function modeComplete(modeDir) {
  return ['h1', 'h2', 'h3'].every((p) => shardCount(modeDir, p) >= PER_SHARD);
}

function waitForMode(modeDir, timeoutMs = 90 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const counts = ['h1', 'h2', 'h3'].map((p) => shardCount(modeDir, p));
    const total = counts.reduce((a, b) => a + b, 0);
    process.stderr.write(`phase32e progress ${path.basename(modeDir)}: ${total}/${MATRIX_TARGET.total}\n`);
    if (modeComplete(modeDir)) return;
    const pgrep = spawnSync('pgrep', ['-fl', 'phase31-controlled-observability-matrix-runner'], {
      encoding: 'utf8',
    });
    if (!(pgrep.stdout || '').trim()) {
      const done = modeComplete(modeDir);
      if (done) return;
      throw new Error(`runners stopped before completion for ${modeDir}`);
    }
    sleepMs(15000);
  }
  throw new Error(`timeout waiting for ${modeDir}`);
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function startShards(modeDir, modeKey) {
  const injection = kpiInjectionEnv(modeKey);
  const runnerEnv = {
    ...process.env,
    ...injection,
    T20_EVAL_RAG_PAUSE_SEC: process.env.T20_EVAL_RAG_PAUSE_SEC || '0.15',
  };
  for (const proto of ['h1', 'h2', 'h3']) {
    const shard = path.join(modeDir, `shard-${proto}`);
    fs.mkdirSync(shard, { recursive: true });
    const logPath = path.join(modeDir, `runner-${proto}.log`);
    const args = [
      RUNNER,
      '--protocol',
      proto,
      '--windows',
      String(MATRIX_TARGET.windows),
      '--runs',
      String(MATRIX_TARGET.runs),
      '--out',
      shard,
      '--resume',
    ];
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: runnerEnv,
      detached: true,
      stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
    });
    child.unref();
    process.stderr.write(`started ${modeKey} ${proto} pid=${child.pid}\n`);
  }
}

async function runMode(root, modeKey) {
  const injection = kpiInjectionEnv(modeKey);
  const modeDir = path.join(root, modeKey);
  fs.mkdirSync(modeDir, { recursive: true });
  process.stderr.write(`phase32e starting mode=${modeKey}\n`);
  setK8sInjectionEnv(injection);
  startShards(modeDir, modeKey);
  waitForMode(modeDir);
  process.stderr.write(`phase32e complete mode=${modeKey}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('phase32e output must be under /tmp');
  fs.mkdirSync(opts.out, { recursive: true });
  for (const modeKey of opts.modes) {
    if (!MODES[modeKey]) throw new Error(`unknown mode ${modeKey}`);
    await runMode(opts.out, modeKey);
  }
  const summarize = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32e-summarize-slow-kpi-write-durability.mjs'), '--in', opts.out],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  process.stdout.write(summarize.stdout);
  process.stderr.write(summarize.stderr);
  process.exit(summarize.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
