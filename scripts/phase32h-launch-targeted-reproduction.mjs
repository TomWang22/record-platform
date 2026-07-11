#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PHASE32H_OUT,
  PHASE32H_EVIDENCE_LABEL,
  TARGET_TOTAL,
} from './lib/phase32h-targeted-reproduction-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: DEFAULT_PHASE32H_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function launchShard(proto, opts, env) {
  const logPath = path.join(opts.out, `runner-${proto}.log`);
  const args = [
    path.join(REPO_ROOT, 'scripts/phase32h-targeted-reproduction-runner.mjs'),
    '--protocol',
    proto,
    '--out',
    opts.out,
    '--resume',
  ];
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ['ignore', fs.openSync(logPath, 'a'), fs.openSync(logPath, 'a')],
  });
  child.unref();
  process.stderr.write(`phase32h started ${proto} pid=${child.pid}\n`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('phase32h out must be under /tmp');
  fs.mkdirSync(opts.out, { recursive: true });

  const manifest = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/phase32h-build-targeted-manifest.mjs'), '--out', opts.out],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (manifest.status !== 0) {
    console.error(manifest.stderr || manifest.stdout);
    process.exit(1);
  }

  const env = { ...process.env, PHASE32H_MATRIX_ROOT: opts.out, T20_EVAL_RAG_PAUSE_SEC: '0.15' };
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh'), opts.out], {
    cwd: REPO_ROOT,
  });

  const watchdog = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts/phase32h-extreme-watchdog.mjs'), '--out', opts.out], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: 'ignore',
  });
  watchdog.unref();

  const telemetry = spawn('bash', [path.join(REPO_ROOT, 'scripts/phase32h-capture-host-telemetry.sh'), opts.out], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: 'ignore',
  });
  telemetry.unref();

  launchShard('h1', opts, env);
  launchShard('h2', opts, env);
  launchShard('h3', opts, env);

  const monitor = spawn('bash', [path.join(REPO_ROOT, 'scripts/phase32h-monitor-targeted-reproduction.sh')], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ['ignore', fs.openSync(path.join(opts.out, 'phase32h-monitor.log'), 'a'), fs.openSync(path.join(opts.out, 'phase32h-monitor.log'), 'a')],
  });
  monitor.unref();

  console.log(
    JSON.stringify(
      {
        status: 'IN_PROGRESS',
        phase: '32H-E',
        evidence_label: PHASE32H_EVIDENCE_LABEL,
        out: opts.out,
        target_total: TARGET_TOTAL,
        watchdog_pid: watchdog.pid,
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
