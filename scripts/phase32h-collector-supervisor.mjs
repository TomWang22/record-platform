#!/usr/bin/env node
/**
 * Phase 32H-R1 — independent collector supervisor (1s heartbeat).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertCollectorCoverageOrBlock,
  evaluateCollectorHealth,
  writeSupervisorHeartbeat,
} from './lib/phase32h-collector-supervision.mjs';
import { isCoverageBlocked } from './lib/phase32h-run-integrity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { out: process.env.PHASE32H_MATRIX_ROOT || '/tmp/phase32h-r1-baseline', intervalMs: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--interval-ms') opts.intervalMs = Number(argv[++i]);
    if (argv[i] === '--monitor-interval-sec') opts.monitorIntervalMs = Number(argv[++i]) * 1000;
  }
  return opts;
}

function listProcesses() {
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return (ps.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter(Boolean);
}

function probesActive(outRoot, processes) {
  return ['h1', 'h2', 'h3'].some((proto) =>
    processes.some(
      (p) =>
        p.command?.includes('phase32h-targeted-reproduction-runner.mjs') &&
        p.command?.includes(`--protocol ${proto}`) &&
        p.command?.includes(outRoot),
    ),
  );
}

function unhealthyDurationMs(outRoot) {
  const file = path.join(outRoot, 'run-state/collector-unhealthy-since.json');
  if (!fs.existsSync(file)) return 0;
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Date.now() - Date.parse(row.since);
}

function markUnhealthySince(outRoot) {
  const file = path.join(outRoot, 'run-state/collector-unhealthy-since.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ since: new Date().toISOString() })}\n`, 'utf8');
  }
}

function clearUnhealthySince(outRoot) {
  const file = path.join(outRoot, 'run-state/collector-unhealthy-since.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function supervisorTick(outRoot, opts = {}) {
  const processes = listProcesses();
  const active = opts.probesActive ?? probesActive(outRoot, processes);
  const health = evaluateCollectorHealth(outRoot, processes, {
    probesActive: active,
    monitorIntervalMs: opts.monitorIntervalMs || 300_000,
  });
  writeSupervisorHeartbeat(outRoot, health);

  if (health.overall_status === 'BLOCKED' && active) {
    markUnhealthySince(outRoot);
    if (unhealthyDurationMs(outRoot) > 10_000) {
      assertCollectorCoverageOrBlock(outRoot, health);
    }
  } else {
    clearUnhealthySince(outRoot);
  }
  return health;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('supervisor out must be under /tmp');
  fs.mkdirSync(path.join(opts.out, 'run-state'), { recursive: true });
  fs.writeFileSync(
    path.join(opts.out, 'run-state/supervisor.pid'),
    `${process.pid}\n`,
    'utf8',
  );

  const timer = setInterval(() => {
    if (isCoverageBlocked(opts.out)) {
      clearInterval(timer);
      process.exit(3);
    }
    supervisorTick(opts.out, opts);
  }, opts.intervalMs);

  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
