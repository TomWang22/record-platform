#!/usr/bin/env node
/**
 * Phase 33F — read-only runtime status (no evidence mutation, no collector control).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCollectorRegistry, evaluatePcapCollectorIdentity } from './lib/phase32h-collector-registry.mjs';
import { readCorrelationQueueSnapshot } from './lib/phase32h-correlation-queue.mjs';
import { listProcessesWide } from './lib/phase32h-process-list.mjs';
import { buildProcessInspection, listCaptureCollectorCandidates } from './lib/phase32h-process-identity.mjs';
import { isCoverageBlocked } from './lib/phase32h-run-integrity.mjs';
import { REAL_CANARY_ROOT, REAL_TARGET_ROOT } from './lib/phase33f-canary-config.mjs';

function parseArgs(argv) {
  const opts = { out: process.env.PHASE33F_MATRIX_ROOT || '/tmp/phase33f-canary-launcher-smoke-v1' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function matrixCounts(outRoot) {
  const counts = { h1: 0, h2: 0, h3: 0, ok: 0, fail: 0 };
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase33f-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    counts[shard] = lines.length;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.ok) counts.ok += 1;
        else counts.fail += 1;
      } catch {
        counts.fail += 1;
      }
    }
  }
  counts.total = counts.h1 + counts.h2 + counts.h3;
  return counts;
}

function diskSnapshot() {
  const df = spawnSync('df', ['-Pk', '/tmp'], { encoding: 'utf8' });
  const line = (df.stdout || '').trim().split('\n').pop();
  const parts = line?.split(/\s+/) || [];
  const availKib = Number(parts[3] || 0);
  return { avail_kib: availKib, avail_bytes: availKib * 1024, avail_gib: (availKib * 1024) / 1073741824 };
}

export function buildPhase33fRuntimeStatus(outRoot) {
  const processes = listProcessesWide();
  const rootProcesses = processes.filter((p) => (p.command || '').includes(outRoot));
  const inspections = rootProcesses.map((p) => buildProcessInspection(p));
  const registry = readCollectorRegistry(outRoot);
  const identity = evaluatePcapCollectorIdentity(outRoot, processes, registry, { probesActive: true });
  const queue = readCorrelationQueueSnapshot(outRoot);
  const matrix = matrixCounts(outRoot);
  const blockedMarkers = [
    'PHASE32H_FOREIGN_COLLECTOR_BLOCKED',
    'PHASE32H_DUPLICATE_COLLECTOR_BLOCKED',
    'COLLECTOR_COVERAGE_BLOCKED',
    'PHASE33F_CANARY_PRELAUNCH_BLOCKED',
  ]
    .filter((name) => fs.existsSync(path.join(outRoot, name)))
    .map((name) => ({ name, path: path.join(outRoot, name) }));

  return {
    at: new Date().toISOString(),
    out: outRoot,
    blocked: isCoverageBlocked(outRoot),
    blocked_markers: blockedMarkers,
    matrix,
    queue,
    registry,
    collector_identity: identity,
    registered_processes: inspections,
    capture_candidates: listCaptureCollectorCandidates(processes).map((c) => ({
      pid: c.pid,
      comm: c.comm,
      executable_basename: c.executable_basename,
      evidence_root: c.evidence_root,
      output_path: c.output_path,
    })),
    real_canary_exists: fs.existsSync(REAL_CANARY_ROOT),
    real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
    frozen_pass: fs.existsSync(path.join(outRoot, 'FROZEN_PASS_EVIDENCE')),
    frozen_blocked: fs.existsSync(path.join(outRoot, 'FROZEN_BLOCKED_EVIDENCE')),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const status = buildPhase33fRuntimeStatus(opts.out);
  status.disk = diskSnapshot();
  console.log(JSON.stringify(status, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
