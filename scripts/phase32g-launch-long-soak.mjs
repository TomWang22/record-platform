#!/usr/bin/env node
/**
 * Phase 32G-1 — launch timing-attributed repaired long soak shards + monitor.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PHASE32G_MATRIX_OUT,
  MATRIX_TARGET,
  PHASE32G_EVIDENCE_LABEL,
} from './lib/phase32g-long-soak-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts/phase31-controlled-observability-matrix-runner.mjs');
const MONITOR = path.join(REPO_ROOT, 'scripts/phase32g-monitor-long-soak.sh');

function parseArgs(argv) {
  const opts = { out: DEFAULT_PHASE32G_MATRIX_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function launchShard(proto, opts, runnerEnv) {
  const shard = path.join(opts.out, `shard-${proto}`);
  fs.mkdirSync(shard, { recursive: true });
  const logPath = path.join(opts.out, `runner-${proto}.log`);
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
  process.stderr.write(`phase32g started ${proto} pid=${child.pid}\n`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('phase32g output must be under /tmp');

  const preflight = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32g-preflight-long-soak.mjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PHASE32G_MATRIX_ROOT: opts.out },
  });
  if (preflight.status !== 0) {
    console.error(preflight.stderr || preflight.stdout);
    process.exit(1);
  }

  fs.mkdirSync(opts.out, { recursive: true });
  const runnerEnv = {
    ...process.env,
    PHASE32G_MATRIX_ROOT: opts.out,
    T20_EVAL_RAG_PAUSE_SEC: process.env.T20_EVAL_RAG_PAUSE_SEC || '0.15',
  };

  launchShard('h1', opts, runnerEnv);
  process.stderr.write('phase32g staggering h2 launch by 45s\n');
  sleepMs(45_000);
  launchShard('h2', opts, runnerEnv);
  process.stderr.write('phase32g staggering h3 launch by 45s\n');
  sleepMs(45_000);
  launchShard('h3', opts, runnerEnv);

  const monitorLog = path.join(opts.out, 'phase32g-monitor.log');
  const monitor = spawn('bash', [MONITOR], {
    cwd: REPO_ROOT,
    env: runnerEnv,
    detached: true,
    stdio: ['ignore', fs.openSync(monitorLog, 'a'), fs.openSync(monitorLog, 'a')],
  });
  monitor.unref();

  console.log(
    JSON.stringify(
      {
        status: 'IN_PROGRESS',
        phase: '32G',
        evidence_label: PHASE32G_EVIDENCE_LABEL,
        out: opts.out,
        target_total: MATRIX_TARGET.total,
        monitor_pid: monitor.pid,
        production_enablement: 'NOT APPROVED',
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
