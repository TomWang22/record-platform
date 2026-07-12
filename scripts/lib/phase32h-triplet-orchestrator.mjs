/**
 * Phase 32H-R1 — synchronized H1/H2/H3 triplet batch orchestrator core.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  batchTimingStatus,
  buildBatchRecord,
  computeStartSpreadMs,
  signalTripletReady,
  waitForTripletBarrier,
  writeBatchRecord,
} from './phase32h-triplet-batch.mjs';
import { writeBatchPacketIndex } from './phase32h-batch-packet-index.mjs';
import { classifyMatrixProbeFailure } from './phase31-controlled-matrix-summary.mjs';
import { isCoverageBlocked } from './phase32h-run-integrity.mjs';
import { supervisorTick } from '../phase32h-collector-supervisor.mjs';
import { writeTripletProbePacketIndexes } from './phase32h-triplet-probe-packet-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'phase32h-triplet-probe-worker.mjs');

export const CORRELATION_BACKLOG_LIMIT = Number(process.env.PHASE32H_CORRELATION_BACKLOG_LIMIT || 50);

export function tripletOrchestratorMarker(outRoot) {
  return path.join(outRoot, 'run-state', 'triplet-orchestrator.json');
}

export function writeTripletOrchestratorMarker(outRoot, payload) {
  const file = tripletOrchestratorMarker(outRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}

export function correlationBacklogPath(outRoot) {
  return path.join(outRoot, 'run-state', 'correlation-backlog.json');
}

export function readCorrelationBacklog(outRoot) {
  const file = correlationBacklogPath(outRoot);
  if (!fs.existsSync(file)) return { pending: 0 };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function enqueueCorrelationJob(outRoot, batchId) {
  const file = correlationBacklogPath(outRoot);
  const row = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { pending: 0, batches: [] };
  row.batches = row.batches || [];
  row.batches.push({ batch_id: batchId, enqueued_at: new Date().toISOString() });
  row.pending = row.batches.length;
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  return row.pending;
}

export function correlationBacklogBlocksLaunch(outRoot) {
  const backlog = readCorrelationBacklog(outRoot);
  return backlog.pending > CORRELATION_BACKLOG_LIMIT;
}

function runProbeWorker(probe, cfg, releaseAtMs, probeContext) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { probe, cfg, releaseAtMs, probeContext },
    });
    worker.on('message', (msg) => {
      if (msg.ok) resolve(msg);
      else reject(new Error(msg.error || 'probe worker failed'));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`probe worker exited ${code}`));
    });
  });
}

/**
 * Execute one synchronized triplet batch with parallel probe workers.
 */
export async function executeTripletBatch({
  outRoot,
  batch,
  cfg,
  runId,
  launchHead,
  manifestSha,
  evidenceLabel,
  coordinator,
  probeContext = {},
  onProbeComplete = null,
}) {
  if (isCoverageBlocked(outRoot)) {
    throw new Error('collector coverage blocked; refusing triplet batch');
  }
  if (correlationBacklogBlocksLaunch(outRoot)) {
    throw new Error('correlation backlog exceeded; pausing new batches');
  }

  supervisorTick(outRoot, { probesActive: true, smokeMode: false });

  const batchId = batch.batch_id;
  const window = batch.coordinate.window;

  coordinator.enterWindow(window, 'triplet', {
    resetAndVerify: probeContext.resetAndVerify,
  });

  for (const proto of ['h1', 'h2', 'h3']) {
    signalTripletReady(outRoot, batchId, proto, {
      probe_id: batch[proto].probe_id,
      batch_id: batchId,
    });
  }

  const barrierReadyAt = new Date().toISOString();
  const releasedAt = waitForTripletBarrier(outRoot, batchId);
  const releaseAtMs = Date.parse(releasedAt) + 5;

  const workerContext = {
    coordinator_wait_ms: probeContext.coordinator_wait_ms ?? 0,
    window_reset_ms: probeContext.window_reset_ms ?? 0,
  };

  const [h1Result, h2Result, h3Result] = await Promise.all([
    runProbeWorker(batch.h1, cfg, releaseAtMs, workerContext),
    runProbeWorker(batch.h2, cfg, releaseAtMs, workerContext),
    runProbeWorker(batch.h3, cfg, releaseAtMs, workerContext),
  ]);

  const starts = {
    h1: h1Result.started_at,
    h2: h2Result.started_at,
    h3: h3Result.started_at,
  };
  const spreadMs = computeStartSpreadMs([starts.h1, starts.h2, starts.h3]);
  const timingStatus = batchTimingStatus(spreadMs);

  const batchRecord = {
    ...buildBatchRecord({
      batchId,
      runId,
      caseId: batch.coordinate.case_id,
      window: batch.coordinate.window,
      run: batch.coordinate.run,
      userClass: batch.coordinate.user_class,
      barrierReadyAt,
      starts,
      collectorHealth: null,
      captureFileIds: [],
    }),
    manifest_sha: manifestSha,
    launch_head: launchHead,
    evidence_label: evidenceLabel,
    barrier_created_at: barrierReadyAt,
    h1_ready_at: barrierReadyAt,
    h2_ready_at: barrierReadyAt,
    h3_ready_at: barrierReadyAt,
    released_at: releasedAt,
    completed_at: new Date().toISOString(),
    member_probe_ids: batch.probe_ids,
    member_statuses: {
      h1: h1Result.probeFail ? 'FAIL' : 'PASS',
      h2: h2Result.probeFail ? 'FAIL' : 'PASS',
      h3: h3Result.probeFail ? 'FAIL' : 'PASS',
    },
    packet_correlation_status: 'PENDING',
    collector_health_status: 'ACTIVE',
    power_snapshot_id: null,
    route_snapshot_id: null,
    start_spread_ms: spreadMs,
    batch_timing_status: timingStatus,
    synchronized_triplet: true,
  };

  if (timingStatus === 'REJECTED') {
    batchRecord.packet_correlation_status = 'BLOCKED';
    writeBatchRecord(outRoot, batchRecord);
    throw new Error(`batch ${batchId} rejected: start spread ${spreadMs}ms`);
  }

  writeBatchRecord(outRoot, batchRecord);
  enqueueCorrelationJob(outRoot, batchId);

  const batchIndex = writeBatchPacketIndex(outRoot, {
    batch_id: batchId,
    run_id: runId,
    member_probe_ids: batch.probe_ids,
    coordinate: batch.coordinate,
    start_spread_ms: spreadMs,
    batch_timing_status: timingStatus,
    packet_correlation_status: 'PENDING',
  });

  const results = { h1: h1Result, h2: h2Result, h3: h3Result, batchRecord, batchIndex };
  writeTripletProbePacketIndexes({
    outRoot,
    batch,
    runId,
    launchHead,
    results,
    failIfExists: true,
  });

  if (onProbeComplete) {
    for (const proto of ['h1', 'h2', 'h3']) {
      onProbeComplete(batch[proto], results[proto].row, outRoot);
    }
  }

  const deterministicMember = ['h1', 'h2', 'h3'].find((proto) => {
    const row = results[proto].row;
    return row.http_status !== 200 && classifyMatrixProbeFailure(row) === 'deterministic';
  });
  if (deterministicMember) {
    const row = results[deterministicMember].row;
    batchRecord.packet_correlation_status = 'BLOCKED';
    batchRecord.deterministic_failure = {
      protocol: deterministicMember,
      http_status: row.http_status,
      gate_reason: row.gate_reason,
      expected_gate_reason: row.expected_gate_reason,
      retry_count: row.timing?.retry_count ?? row.retry_count,
    };
    writeBatchRecord(outRoot, batchRecord);
    throw new Error(
      `deterministic gate failure on ${deterministicMember}: http_status=${row.http_status} gate=${row.gate_reason}`,
    );
  }

  coordinator.completeWindowProtocol(window, 'triplet');
  return results;
}

export function mainMatrixUsesTripletOrchestrator(launchScriptPath) {
  const text = fs.readFileSync(launchScriptPath, 'utf8');
  return (
    text.includes('phase32h-r1-triplet-runner.mjs') &&
    !text.includes("launchShard('h1'") &&
    (text.includes('runBaselineLaunchPreflight') || text.includes('phase32h-r1-prelaunch'))
  );
}
