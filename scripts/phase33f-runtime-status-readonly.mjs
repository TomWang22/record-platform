#!/usr/bin/env node
/**
 * Phase 33F/34 — read-only runtime status (no evidence mutation, no collector control).
 * Matrix counters are streamed; process identity uses registry/PID, not argv includes.
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
import { readRunnerResourceTelemetryTail } from './lib/phase33f-runner-resource-telemetry.mjs';
import {
  streamMatrixCounters,
  classifyRuntimeAcceptance,
} from './lib/phase34-runtime-status-bounded.mjs';
import { PHASE34_LIVE_BLOCK_MARKER } from './lib/phase34-live-fail-closed.mjs';

function parseArgs(argv) {
  const opts = { out: process.env.PHASE33F_MATRIX_ROOT || '/tmp/phase33f-canary-launcher-smoke-v1' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function diskSnapshot() {
  const df = spawnSync('df', ['-Pk', '/tmp'], { encoding: 'utf8' });
  const line = (df.stdout || '').trim().split('\n').pop();
  const parts = line?.split(/\s+/) || [];
  const availKib = Number(parts[3] || 0);
  return { avail_kib: availKib, avail_bytes: availKib * 1024, avail_gib: (availKib * 1024) / 1073741824 };
}

function registeredRootProcesses(outRoot, processes, registry) {
  const byPid = new Map();
  for (const role of Object.keys(registry?.collectors || {})) {
    const entry = registry.collectors[role];
    if (!entry?.pid) continue;
    const proc = processes.find((p) => Number(p.pid) === Number(entry.pid));
    if (proc) byPid.set(Number(entry.pid), { ...proc, role });
  }
  // Include capture candidates whose resolved evidence_root matches (phase32h/33f/34).
  for (const cand of listCaptureCollectorCandidates(processes)) {
    if (cand.evidence_root === outRoot) {
      byPid.set(Number(cand.pid), { ...cand, role: cand.role || 'pcap_collector' });
    }
  }
  return [...byPid.values()];
}

export async function buildPhase33fRuntimeStatus(outRoot) {
  const processes = listProcessesWide();
  const registry = readCollectorRegistry(outRoot);
  const rootProcesses = registeredRootProcesses(outRoot, processes, registry);
  const inspections = rootProcesses.map((p) => buildProcessInspection(p));
  const identity = evaluatePcapCollectorIdentity(outRoot, processes, registry, { probesActive: true });
  const queue = readCorrelationQueueSnapshot(outRoot);
  const matrix = await streamMatrixCounters(outRoot);
  // Bounded tail read — never load the full telemetry history into memory.
  const resourceTelemetry = await readRunnerResourceTelemetryTail(outRoot, { limit: 32 });
  const latest = resourceTelemetry.latest;
  const liveBlock = fs.existsSync(path.join(outRoot, PHASE34_LIVE_BLOCK_MARKER));
  const frozenPass = fs.existsSync(path.join(outRoot, 'FROZEN_PASS_EVIDENCE'));
  const frozenBlocked = fs.existsSync(path.join(outRoot, 'FROZEN_BLOCKED_EVIDENCE'));
  const blockedMarkers = [
    'PHASE32H_FOREIGN_COLLECTOR_BLOCKED',
    'PHASE32H_DUPLICATE_COLLECTOR_BLOCKED',
    'COLLECTOR_COVERAGE_BLOCKED',
    'PHASE33F_CANARY_PRELAUNCH_BLOCKED',
    PHASE34_LIVE_BLOCK_MARKER,
  ]
    .filter((name) => fs.existsSync(path.join(outRoot, name)))
    .map((name) => ({ name, path: path.join(outRoot, name) }));

  const runnerAlive = Boolean(
    latest?.timestamp &&
      Date.now() - Date.parse(latest.timestamp) < 120_000 &&
      !frozenPass &&
      !frozenBlocked,
  );
  const classification = classifyRuntimeAcceptance({
    frozenPass,
    frozenBlocked,
    protocolFail: matrix.fail,
    logicalFail: matrix.logical_fail,
    liveBlockMarker: liveBlock,
    queueCompleteIncreasing: false,
    runnerAlive,
  });

  return {
    at: new Date().toISOString(),
    out: outRoot,
    blocked: isCoverageBlocked(outRoot) || liveBlock,
    blocked_markers: blockedMarkers,
    matrix: {
      h1: matrix.h1,
      h2: matrix.h2,
      h3: matrix.h3,
      ok: matrix.ok,
      fail: matrix.fail,
      total: matrix.total,
    },
    logical: {
      complete: matrix.logical_complete,
      pass: matrix.logical_pass,
      fail: matrix.logical_fail,
      capability: matrix.capability_logical,
    },
    http: {
      http_0: matrix.http_0,
      http_422: matrix.http_422,
      http_429: matrix.http_429,
      http_5xx: matrix.http_5xx,
      curl_failures: matrix.curl_failures,
    },
    execution_state: classification.execution_state,
    acceptance_state: classification.acceptance_state,
    cooperative_termination_required: classification.cooperative_termination_required,
    queue,
    registry,
    collector_identity: identity,
    registered_processes: inspections,
    capture_candidates: listCaptureCollectorCandidates(processes)
      .filter((c) => c.evidence_root === outRoot)
      .map((c) => ({
        pid: c.pid,
        comm: c.comm,
        executable_basename: c.executable_basename,
        evidence_root: c.evidence_root,
        output_path: c.output_path,
      })),
    resource_telemetry: {
      status: resourceTelemetry.status,
      malformed: resourceTelemetry.malformed || 0,
      lines_seen: resourceTelemetry.lines_seen || 0,
      tail_rows: resourceTelemetry.rows.length,
      peaks: resourceTelemetry.peaks,
      latest: latest
        ? {
            timestamp: latest.timestamp,
            completed_batch: latest.completed_batch,
            probe_total: latest.probe_total,
            rss_mb: latest.rss_mb,
            heap_used_mb: latest.heap_used_mb,
            worker_configured: latest.worker_configured,
            worker_active: latest.worker_active,
            worker_peak: latest.worker_peak,
            message_port_current: latest.message_port_current,
            message_port_peak: latest.message_port_peak,
            listener_current: latest.listener_current,
            listener_peak: latest.listener_peak,
            active_handle_current: latest.active_handle_current,
            active_handle_peak: latest.active_handle_peak,
            worker_queue_depth: latest.worker_queue_depth,
            queue_pending: latest.queue_pending,
            queue_running: latest.queue_running,
            queue_complete: latest.queue_complete,
            queue_failed: latest.queue_failed,
          }
        : null,
    },
    real_canary_exists: fs.existsSync(REAL_CANARY_ROOT),
    real_target_exists: fs.existsSync(REAL_TARGET_ROOT),
    frozen_pass: frozenPass,
    frozen_blocked: frozenBlocked,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const status = await buildPhase33fRuntimeStatus(opts.out);
  status.disk = diskSnapshot();
  console.log(JSON.stringify(status, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
