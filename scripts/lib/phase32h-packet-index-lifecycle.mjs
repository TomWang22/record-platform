/**
 * Phase 32H-R1 — batch packet-index lifecycle + alignment classification.
 *
 * Index count vs completed batches may legitimately lead by +1 while an active
 * PRE_MATRIX/RUNNING batch holds a PENDING index. That is not BLOCKED.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  batchIndexPath,
  listBatchPacketIndexes,
  readBatchPacketIndex,
  updateBatchPacketIndex,
  writeBatchPacketIndex,
} from './phase32h-batch-packet-index.mjs';
import { probeIndexDir } from './phase32h-probe-packet-index.mjs';
import { readCorrelationQueueSnapshot } from './phase32h-correlation-queue.mjs';

function tripletOrchestratorMarkerPath(outRoot) {
  return path.join(outRoot, 'run-state', 'triplet-orchestrator.json');
}

function listProbePacketIndexesLocal(outRoot) {
  const dir = probeIndexDir(outRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, probe_id: Number(name.replace(/\.json$/, '')), record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    });
}

export const BATCH_INDEX_LIFECYCLE = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  CORRELATING: 'CORRELATING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
});

export const BATCH_INDEX_ALIGNMENT = Object.freeze({
  ALIGNED: 'ALIGNED',
  ACTIVE_TRANSIENT_LEAD: 'ACTIVE_TRANSIENT_LEAD',
  BLOCKED_ORPHAN_INDEX: 'BLOCKED_ORPHAN_INDEX',
  BLOCKED_INDEX_LEAD: 'BLOCKED_INDEX_LEAD',
  BLOCKED_INDEX_DEFICIT: 'BLOCKED_INDEX_DEFICIT',
  BLOCKED_BATCH_ID_MISMATCH: 'BLOCKED_BATCH_ID_MISMATCH',
  BLOCKED_QUEUE_FAILURE: 'BLOCKED_QUEUE_FAILURE',
  BLOCKED_MALFORMED_INDEX: 'BLOCKED_MALFORMED_INDEX',
  TERMINAL_PASS: 'TERMINAL_PASS',
  SNAPSHOT_CHANGED_DURING_READ: 'SNAPSHOT_CHANGED_DURING_READ',
});

export function isBlockedAlignment(status) {
  return typeof status === 'string' && status.startsWith('BLOCKED_');
}

export function readTripletOrchestratorState(outRoot) {
  const file = tripletOrchestratorMarkerPath(outRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function patchTripletOrchestratorMarker(outRoot, patch) {
  const prev = readTripletOrchestratorState(outRoot) || {};
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
  const file = tripletOrchestratorMarkerPath(outRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function completedBatchCountFromFs(outRoot) {
  const dir = path.join(outRoot, 'batches');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length;
}

export function validateBatchIndexRecord(record) {
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: 'missing_record' };
  }
  if (!record.batch_id || typeof record.batch_id !== 'string') {
    return { ok: false, reason: 'missing_batch_id' };
  }
  const status = record.packet_correlation_status;
  if (!Object.values(BATCH_INDEX_LIFECYCLE).includes(status)) {
    return { ok: false, reason: `invalid_status:${status}` };
  }
  return { ok: true };
}

/**
 * Atomic PENDING → COMPLETE after probes, matrix rows, and correlation succeed.
 */
export function completeBatchPacketIndex(outRoot, batchId, patch = {}) {
  return updateBatchPacketIndex(outRoot, batchId, {
    ...patch,
    packet_correlation_status: BATCH_INDEX_LIFECYCLE.COMPLETE,
    overall_correlation_status: BATCH_INDEX_LIFECYCLE.COMPLETE,
    completed_at: new Date().toISOString(),
  });
}

export function failBatchPacketIndex(outRoot, batchId, patch = {}) {
  return updateBatchPacketIndex(outRoot, batchId, {
    ...patch,
    packet_correlation_status: BATCH_INDEX_LIFECYCLE.FAILED,
    overall_correlation_status: BATCH_INDEX_LIFECYCLE.FAILED,
    failed_at: new Date().toISOString(),
  });
}

export function markBatchPacketIndexStatus(outRoot, batchId, status, patch = {}) {
  if (!Object.values(BATCH_INDEX_LIFECYCLE).includes(status)) {
    throw new Error(`invalid batch index lifecycle status: ${status}`);
  }
  if (!fs.existsSync(batchIndexPath(outRoot, batchId))) {
    throw new Error(`batch index missing for status transition: ${batchId}`);
  }
  return updateBatchPacketIndex(outRoot, batchId, {
    ...patch,
    packet_correlation_status: status,
    overall_correlation_status: status,
  });
}

export function evaluateBatchIndexAlignment({
  batchIndexes = [],
  completedBatchCount = 0,
  activeBatchId = null,
  phase = null,
  queue = { failed_count: 0, pending_count: 0, running_count: 0, complete_count: 0 },
  orchestratorStatus = null,
  targetBatches = null,
  targetProbes = null,
  probeIndexCount = null,
} = {}) {
  if ((queue.failed_count || 0) > 0) {
    return {
      status: BATCH_INDEX_ALIGNMENT.BLOCKED_QUEUE_FAILURE,
      delta: batchIndexes.length - completedBatchCount,
      extra_ids: [],
    };
  }

  for (const row of batchIndexes) {
    const check = validateBatchIndexRecord(row.record || row);
    if (!check.ok) {
      return {
        status: BATCH_INDEX_ALIGNMENT.BLOCKED_MALFORMED_INDEX,
        delta: batchIndexes.length - completedBatchCount,
        malformed_reason: check.reason,
        batch_id: row.batch_id || row.record?.batch_id,
      };
    }
  }

  const indexIds = new Set(batchIndexes.map((b) => b.batch_id || b.record?.batch_id));
  const delta = batchIndexes.length - completedBatchCount;

  const terminalExact =
    orchestratorStatus === 'COMPLETE' &&
    !activeBatchId &&
    targetBatches != null &&
    completedBatchCount === targetBatches &&
    batchIndexes.length === targetBatches &&
    delta === 0 &&
    (targetProbes == null || probeIndexCount === targetProbes) &&
    (queue.pending_count || 0) === 0 &&
    (queue.running_count || 0) === 0 &&
    (queue.failed_count || 0) === 0 &&
    (queue.complete_count == null || queue.complete_count === targetBatches) &&
    batchIndexes.every(
      (b) => (b.record || b).packet_correlation_status === BATCH_INDEX_LIFECYCLE.COMPLETE,
    );

  if (terminalExact) {
    return { status: BATCH_INDEX_ALIGNMENT.TERMINAL_PASS, delta: 0, extra_ids: [] };
  }

  if (delta < 0) {
    return { status: BATCH_INDEX_ALIGNMENT.BLOCKED_INDEX_DEFICIT, delta, extra_ids: [] };
  }
  if (delta > 1) {
    return {
      status: BATCH_INDEX_ALIGNMENT.BLOCKED_INDEX_LEAD,
      delta,
      extra_ids: [...indexIds],
    };
  }
  if (delta === 0) {
    return { status: BATCH_INDEX_ALIGNMENT.ALIGNED, delta: 0, extra_ids: [] };
  }

  // delta === 1
  const completedIds = new Set(
    batchIndexes
      .filter((b) => (b.record || b).packet_correlation_status === BATCH_INDEX_LIFECYCLE.COMPLETE)
      .map((b) => b.batch_id || b.record?.batch_id),
  );
  // Extra = indexes not yet matching completed count; prefer PENDING among newest
  const pending = batchIndexes.filter(
    (b) => (b.record || b).packet_correlation_status === BATCH_INDEX_LIFECYCLE.PENDING
      || (b.record || b).packet_correlation_status === BATCH_INDEX_LIFECYCLE.RUNNING
      || (b.record || b).packet_correlation_status === BATCH_INDEX_LIFECYCLE.CORRELATING,
  );
  const extraIds = pending.length
    ? pending.map((b) => b.batch_id || b.record?.batch_id)
    : batchIndexes
        .map((b) => b.batch_id || b.record?.batch_id)
        .filter((id) => !completedIds.has(id));

  if (!activeBatchId) {
    return {
      status: BATCH_INDEX_ALIGNMENT.BLOCKED_ORPHAN_INDEX,
      delta: 1,
      extra_ids: extraIds,
    };
  }
  if (extraIds.length !== 1 || extraIds[0] !== activeBatchId) {
    return {
      status: BATCH_INDEX_ALIGNMENT.BLOCKED_BATCH_ID_MISMATCH,
      delta: 1,
      extra_ids: extraIds,
      active_batch_id: activeBatchId,
    };
  }
  const extra = batchIndexes.find((b) => (b.batch_id || b.record?.batch_id) === activeBatchId);
  const extraStatus = (extra?.record || extra)?.packet_correlation_status;
  const phaseOk =
    phase == null ||
    phase === 'PRE_MATRIX' ||
    phase === 'RUNNING' ||
    phase === 'CORRELATING' ||
    String(phase).toUpperCase().includes('PRE_MATRIX') ||
    String(phase).toUpperCase().includes('RUNNING');
  if (
    phaseOk &&
    (extraStatus === BATCH_INDEX_LIFECYCLE.PENDING ||
      extraStatus === BATCH_INDEX_LIFECYCLE.RUNNING ||
      extraStatus === BATCH_INDEX_LIFECYCLE.CORRELATING)
  ) {
    return {
      status: BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD,
      delta: 1,
      extra_ids: extraIds,
      active_batch_id: activeBatchId,
      extra_status: extraStatus,
    };
  }
  return {
    status: BATCH_INDEX_ALIGNMENT.BLOCKED_ORPHAN_INDEX,
    delta: 1,
    extra_ids: extraIds,
    extra_status: extraStatus,
    phase,
  };
}

/**
 * Build a fingerprint of mutable status inputs; detect mixed-time reads.
 */
export function snapshotFingerprint({
  matrixTotal,
  completedBatchCount,
  batchIndexCount,
  probeIndexCount,
  queue,
  orchestrator,
}) {
  return JSON.stringify({
    matrixTotal,
    completedBatchCount,
    batchIndexCount,
    probeIndexCount,
    queue: {
      pending: queue?.pending_count ?? 0,
      running: queue?.running_count ?? 0,
      complete: queue?.complete_count ?? 0,
      failed: queue?.failed_count ?? 0,
    },
    orch: {
      status: orchestrator?.status ?? null,
      phase: orchestrator?.phase ?? null,
      active: orchestrator?.active_batch_id ?? null,
    },
  });
}

export function evaluatePacketIndexLifecycle(outRoot, {
  expectedProbeIndexes = null,
  expectedBatchCorrelations = null,
  targetBatches = null,
  targetProbes = null,
  completedBatchCount = null,
  matrixTotal = null,
} = {}) {
  const beforeOrch = readTripletOrchestratorState(outRoot);
  const beforeQueue = readCorrelationQueueSnapshot(outRoot);
  const batchIndexes = listBatchPacketIndexes(outRoot);
  const probeIndexes = listProbePacketIndexesLocal(outRoot);
  const completed =
    completedBatchCount != null ? completedBatchCount : completedBatchCountFromFs(outRoot);
  const afterOrch = readTripletOrchestratorState(outRoot);
  const afterQueue = readCorrelationQueueSnapshot(outRoot);

  const fpBefore = snapshotFingerprint({
    matrixTotal,
    completedBatchCount: completed,
    batchIndexCount: batchIndexes.length,
    probeIndexCount: probeIndexes.length,
    queue: beforeQueue,
    orchestrator: beforeOrch,
  });
  const fpAfter = snapshotFingerprint({
    matrixTotal,
    completedBatchCount: completed,
    batchIndexCount: listBatchPacketIndexes(outRoot).length,
    probeIndexCount: listProbePacketIndexesLocal(outRoot).length,
    queue: afterQueue,
    orchestrator: afterOrch,
  });

  if (fpBefore !== fpAfter) {
    return {
      status: BATCH_INDEX_ALIGNMENT.SNAPSHOT_CHANGED_DURING_READ,
      classification: BATCH_INDEX_ALIGNMENT.SNAPSHOT_CHANGED_DURING_READ,
      discard: true,
      probe_index_count: probeIndexes.length,
      batch_correlation_count: batchIndexes.length,
      delta: null,
    };
  }

  const orch = afterOrch || {};
  const alignment = evaluateBatchIndexAlignment({
    batchIndexes,
    completedBatchCount: completed,
    activeBatchId: orch.active_batch_id || null,
    phase: orch.phase || null,
    queue: afterQueue,
    orchestratorStatus: orch.status || null,
    targetBatches: targetBatches ?? expectedBatchCorrelations,
    targetProbes: targetProbes ?? expectedProbeIndexes,
    probeIndexCount: probeIndexes.length,
  });

  const coveragePass =
    (expectedProbeIndexes == null || probeIndexes.length === expectedProbeIndexes) &&
    (expectedBatchCorrelations == null || batchIndexes.length === expectedBatchCorrelations);

  return {
    ...alignment,
    classification: alignment.status,
    coverage_pass: coveragePass && !isBlockedAlignment(alignment.status),
    probe_index_count: probeIndexes.length,
    batch_correlation_count: batchIndexes.length,
    expected_probe_indexes: expectedProbeIndexes,
    expected_batch_correlations: expectedBatchCorrelations,
    completed_batch_count: completed,
    active_batch_id: orch.active_batch_id || null,
    phase: orch.phase || null,
    orchestrator_status: orch.status || null,
    pending_batch_indexes: batchIndexes.filter(
      (b) => b.record?.packet_correlation_status === BATCH_INDEX_LIFECYCLE.PENDING,
    ).length,
    complete_batch_indexes: batchIndexes.filter(
      (b) => b.record?.packet_correlation_status === BATCH_INDEX_LIFECYCLE.COMPLETE,
    ).length,
  };
}

export { writeBatchPacketIndex, readBatchPacketIndex, updateBatchPacketIndex, listBatchPacketIndexes };
