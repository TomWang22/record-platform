/**
 * Phase 32H-R1 — synchronized H1/H2/H3 triplet batch barrier and spread gates.
 */
import fs from 'node:fs';
import path from 'node:path';

export const BATCH_SPREAD_PREFERRED_MS = 50;
export const BATCH_SPREAD_MAX_PASS_MS = 100;
export const BATCH_SPREAD_REJECT_MS = 500;

export function batchIdFromProbe(probe) {
  return `batch-w${probe.window}-r${probe.run}-u${probe.user_uid}-c${probe.case_id}`;
}

export function computeStartSpreadMs(startedAts) {
  const times = startedAts.filter((t) => t != null).map((t) => Date.parse(t));
  if (times.length < 2) return 0;
  return Math.max(...times) - Math.min(...times);
}

export function batchTimingStatus(spreadMs) {
  if (spreadMs > BATCH_SPREAD_REJECT_MS) return 'REJECTED';
  if (spreadMs > BATCH_SPREAD_MAX_PASS_MS) return 'PARTIAL';
  return 'PASS';
}

export function writeBatchRecord(outRoot, record) {
  const dir = path.join(outRoot, 'batches');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.batch_id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

export function buildBatchRecord({
  batchId,
  runId,
  caseId,
  window,
  run,
  userClass,
  barrierReadyAt,
  starts,
  collectorHealth = null,
  captureFileIds = [],
}) {
  const spreadMs = computeStartSpreadMs([starts.h1, starts.h2, starts.h3]);
  return {
    batch_id: batchId,
    run_id: runId,
    case_id: caseId,
    window,
    run,
    user_class: userClass,
    barrier_ready_at: barrierReadyAt,
    h1_started_at: starts.h1,
    h2_started_at: starts.h2,
    h3_started_at: starts.h3,
    start_spread_ms: spreadMs,
    batch_timing_status: batchTimingStatus(spreadMs),
    capture_file_ids: captureFileIds,
    collector_health_snapshot: collectorHealth,
    synchronized_triplet: true,
  };
}

export function tripletBarrierPaths(outRoot, batchId) {
  const base = path.join(outRoot, 'run-state', 'barriers', batchId);
  return {
    base,
    h1: path.join(base, 'h1.ready'),
    h2: path.join(base, 'h2.ready'),
    h3: path.join(base, 'h3.ready'),
    release: path.join(base, 'released.json'),
  };
}

export function signalTripletReady(outRoot, batchId, protocolKey, meta = {}) {
  const paths = tripletBarrierPaths(outRoot, batchId);
  fs.mkdirSync(paths.base, { recursive: true });
  const file = paths[protocolKey];
  fs.writeFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), protocol: protocolKey, ...meta }, null, 2)}\n`,
    'utf8',
  );
  return file;
}

export function allTripletReady(outRoot, batchId) {
  const paths = tripletBarrierPaths(outRoot, batchId);
  return ['h1', 'h2', 'h3'].every((p) => fs.existsSync(paths[p]));
}

export function releaseTripletBarrier(outRoot, batchId) {
  const paths = tripletBarrierPaths(outRoot, batchId);
  const releasedAt = new Date().toISOString();
  fs.writeFileSync(paths.release, `${JSON.stringify({ released_at: releasedAt }, null, 2)}\n`, 'utf8');
  return releasedAt;
}

export function waitForTripletBarrier(outRoot, batchId, { timeoutMs = 30_000, pollMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (allTripletReady(outRoot, batchId)) {
      return releaseTripletBarrier(outRoot, batchId);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
  }
  throw new Error(`triplet barrier timeout for ${batchId}`);
}
