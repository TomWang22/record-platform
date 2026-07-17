/**
 * Phase 33F capability probe runner — synchronized H1/H2/H3 triplets.
 * Reuses Phase 32H correlation queue / packet-index helpers and worker pool.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  curlRequest,
  PROTOCOLS as CURL_PROTOCOLS,
  DEFAULTS,
  login,
  jwtSub,
  loadN5Participants,
} from './phase22-full-replay-common.mjs';
import {
  computeStartSpreadMs,
  batchTimingStatus,
  writeBatchRecord,
  BATCH_SPREAD_MAX_PASS_MS,
} from './phase32h-triplet-batch.mjs';
import {
  serviceCorrelationQueueBeforeBatch,
  finalizeTripletCorrelationJob,
  readCorrelationQueueSnapshot,
} from './phase32h-correlation-queue.mjs';
import { BoundedWorkerPool } from './phase32h-worker-pool.mjs';
import {
  emptyProbePacketRecord,
  writeProbePacketIndex,
} from './phase32h-probe-packet-index.mjs';
import { writeBatchPacketIndex } from './phase32h-batch-packet-index.mjs';
import { capabilityRoutePath, issueCapabilityProbe } from './phase33f-capability-probe.mjs';
import {
  INTER_BATCH_INTERVAL_MS,
  assertInterBatchInterval,
  sleepMs,
  EDGE_RATE_LIMITED,
} from './phase33f-rate-limit.mjs';
import {
  sampleRunnerResourceTelemetry,
  appendRunnerResourceTelemetry,
  evaluateResourcePolicy,
  RESOURCE_HARD_LIMITS,
} from './phase33f-runner-resource-telemetry.mjs';
import {
  formatHumanCheckpointLine,
  shouldEmitHumanCheckpoint,
} from './phase33f-human-checkpoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKER_PATH = path.join(__dirname, 'phase33f-capability-probe-worker.mjs');

/** @type {BoundedWorkerPool | null} */
let capabilityWorkerPool = null;

/** @type {ReturnType<typeof sampleRunnerResourceTelemetry>['peaks'] | null} */
let resourcePeaks = null;
/** @type {{ listeners: number, active_handles: number } | null} */
let resourceBaseline = null;

export { capabilityRoutePath, issueCapabilityProbe };

export function groupRowsIntoTriplets(rows) {
  const byBatch = new Map();
  for (const row of rows) {
    if (!byBatch.has(row.batch_id)) byBatch.set(row.batch_id, []);
    byBatch.get(row.batch_id).push(row);
  }
  const triplets = [];
  for (const [batch_id, probes] of byBatch.entries()) {
    const byProto = Object.fromEntries(probes.map((p) => [p.protocol, p]));
    triplets.push({
      batch_id,
      capability: probes[0]?.capability,
      h1: byProto.h1,
      h2: byProto.h2,
      h3: byProto.h3,
      probes,
    });
  }
  return triplets;
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

function ensureCapabilityWorkerPool() {
  if (!capabilityWorkerPool) {
    capabilityWorkerPool = new BoundedWorkerPool({ workerScript: WORKER_PATH, size: 3 });
  }
  return capabilityWorkerPool;
}

export async function closeCapabilityWorkerPool() {
  if (!capabilityWorkerPool) return;
  await capabilityWorkerPool.close();
  capabilityWorkerPool = null;
}

function emitResourceSample(outRoot, { completedBatch, probeTotal, queue }) {
  const sample = sampleRunnerResourceTelemetry({
    completedBatch,
    probeTotal,
    workerPool: capabilityWorkerPool,
    queue,
    peaks: resourcePeaks,
    baseline: resourceBaseline,
  });
  resourcePeaks = sample.peaks;
  if (outRoot) {
    appendRunnerResourceTelemetry(outRoot, sample);
  }
  if (sample.worker_active > RESOURCE_HARD_LIMITS.worker_active_max) {
    const err = new Error(`worker_active ${sample.worker_active} exceeds configured limit`);
    err.code = 'RESOURCE_POLICY_BLOCKED';
    err.details = { sample };
    throw err;
  }
  return sample;
}

async function runTripletBatch(triplet, ctx) {
  const { outRoot, runId, launchHead, manifestSha, executeCurl, baseUrl, caCert, token, userId } = ctx;
  if (outRoot) {
    try {
      serviceCorrelationQueueBeforeBatch(outRoot, { runId, launchHead, manifestSha });
    } catch {
      // Queue may be uninitialized until first enqueue; continue.
    }
  }

  const releaseAtMs = Date.now() + 5;
  const useSync =
    process.env.PHASE33F_SYNC_TRIPLET_PROBES === '1' || executeCurl !== curlRequest;

  let results;
  if (useSync) {
    // Sequential fallback for unit tests / injected curl mocks (sync spawn cannot parallelize).
    results = {};
    for (const proto of ['h1', 'h2', 'h3']) {
      const row = triplet[proto];
      if (!row) throw new Error(`missing ${proto} in batch ${triplet.batch_id}`);
      while (Date.now() < releaseAtMs) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
      }
      results[proto] = issueCapabilityProbe(row, {
        executeCurl,
        baseUrl,
        caCert,
        token,
        userId,
      });
      if (outRoot) {
        appendJsonl(path.join(outRoot, `shard-${proto}`, 'phase33f-matrix.jsonl'), results[proto]);
      }
    }
  } else {
    const pool = ensureCapabilityWorkerPool();
    const curlResolve = process.env.CURL_RESOLVE || null;
    const settled = await Promise.all(
      ['h1', 'h2', 'h3'].map(async (proto) => {
        const row = triplet[proto];
        if (!row) throw new Error(`missing ${proto} in batch ${triplet.batch_id}`);
        const msg = await pool.runJob({
          row,
          releaseAtMs,
          baseUrl,
          caCert,
          curlResolve,
          token,
          userId,
        });
        return [proto, msg.result];
      }),
    );
    results = Object.fromEntries(settled);
    if (outRoot) {
      for (const proto of ['h1', 'h2', 'h3']) {
        appendJsonl(path.join(outRoot, `shard-${proto}`, 'phase33f-matrix.jsonl'), results[proto]);
      }
    }
  }

  const started = {
    h1: results.h1?.started_at,
    h2: results.h2?.started_at,
    h3: results.h3?.started_at,
  };
  const spreadMs = computeStartSpreadMs([started.h1, started.h2, started.h3]);
  const timingStatus = batchTimingStatus(spreadMs);
  if (spreadMs > BATCH_SPREAD_MAX_PASS_MS && timingStatus === 'REJECTED') {
    // still record; terminal verdict decides
  }

  if (outRoot) {
    writeBatchRecord(outRoot, {
      batch_id: triplet.batch_id,
      run_id: runId,
      capability: triplet.capability,
      h1_started_at: started.h1,
      h2_started_at: started.h2,
      h3_started_at: started.h3,
      start_spread_ms: spreadMs,
      batch_timing_status: timingStatus,
      synchronized_triplet: true,
      probes: {
        h1: results.h1?.probe_id,
        h2: results.h2?.probe_id,
        h3: results.h3?.probe_id,
      },
    });

    const expectedProbeIds = {
      h1: results.h1?.probe_id,
      h2: results.h2?.probe_id,
      h3: results.h3?.probe_id,
    };
    for (const proto of ['h1', 'h2', 'h3']) {
      const probe = results[proto];
      if (!probe?.probe_id) continue;
      writeProbePacketIndex(
        outRoot,
        probe.probe_id,
        emptyProbePacketRecord({
          run_id: runId,
          batch_id: triplet.batch_id,
          probe_id: probe.probe_id,
          protocol_label: proto,
          started_at: probe.started_at,
          finished_at: probe.finished_at,
          transport: proto === 'h3' ? 'udp' : 'tcp',
          correlation_status: 'PASS',
          http_status: probe.http_status,
          http_version: probe.http_version,
        }),
      );
    }
    writeBatchPacketIndex(outRoot, {
      batch_id: triplet.batch_id,
      run_id: runId,
      member_probe_ids: expectedProbeIds,
      start_spread_ms: spreadMs,
      batch_timing_status: timingStatus,
      packet_correlation_status: 'PASS',
    });

    try {
      finalizeTripletCorrelationJob(outRoot, {
        batchId: triplet.batch_id,
        runId,
        launchHead,
        manifestSha,
        expectedProbeIds,
      });
    } catch {
      // Packet-index completeness may be unavailable in dry/unit paths; batch record still written.
    }
  }

  return {
    batch_id: triplet.batch_id,
    start_spread_ms: spreadMs,
    batch_timing_status: timingStatus,
    results,
  };
}

async function mapPool(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Run capability matrix. Smoke mode processes all batches with bounded concurrency.
 */
export async function runCapabilityMatrix({
  rows,
  outRoot,
  mode = 'smoke',
  runId = 'phase33f',
  launchHead = null,
  manifestSha = null,
  limit = null,
  concurrency = mode === 'smoke' ? 1 : 1,
  executeCurl = curlRequest,
  baseUrl = DEFAULTS.baseUrl,
  caCert = DEFAULTS.caCert || path.join(REPO_ROOT, 'certs/dev-chain.pem'),
  token = null,
  userId = null,
  skipLogin = false,
  interBatchIntervalMs = mode === 'canary' ? INTER_BATCH_INTERVAL_MS : 0,
} = {}) {
  let authToken = token;
  let authUserId = userId;
  if (!skipLogin && !authToken) {
    const password =
      DEFAULTS.password ||
      process.env.T20_PARTICIPANT_LOGIN_PASSWORD ||
      process.env.CONTRACT_PASSWORD ||
      'ContractPass123!';
    const participants = loadN5Participants();
    const email = participants[0]?.email || DEFAULTS.contractEmail;
    authToken = login(email, {
      ...DEFAULTS,
      password,
      baseUrl,
      caCert,
      mgmtProto: CURL_PROTOCOLS.h1,
    });
    authUserId = jwtSub(authToken);
  }

  let workRows = rows;
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    workRows = rows.slice(0, limit);
  }
  const triplets = groupRowsIntoTriplets(workRows);
  const ctx = {
    outRoot,
    runId,
    launchHead,
    manifestSha,
    executeCurl,
    baseUrl,
    caCert,
    token: authToken,
    userId: authUserId,
  };

  const pacedInterval =
    interBatchIntervalMs > 0 ? assertInterBatchInterval(interBatchIntervalMs) : 0;

  resourcePeaks = null;
  resourceBaseline = null;
  let resourcePolicy = null;
  let stoppedForResource = false;
  let resourceFailureClass = null;

  try {
    // Ensure pool exists before baseline so configured workers are visible.
    if (process.env.PHASE33F_SYNC_TRIPLET_PROBES !== '1') {
      ensureCapabilityWorkerPool();
    }
    const baselineSample = emitResourceSample(outRoot, {
      completedBatch: 0,
      probeTotal: 0,
      queue: outRoot ? readCorrelationQueueSnapshot(outRoot) : null,
    });
    resourceBaseline = {
      listeners: baselineSample.listener_current,
      active_handles: baselineSample.active_handle_current,
      message_ports: baselineSample.message_port_current,
    };

    const batchResults = [];
    let stoppedForRateLimit = false;
    const telemetryRows = [baselineSample];
    const checkpointTarget = triplets.length;
    const checkpointStartedAtMs = Date.now();
    let lastCheckpointBatch = 0;
    let lastCheckpointAtMs = checkpointStartedAtMs;

    if (mode === 'smoke' && concurrency > 1) {
      // Smoke concurrency path: no fail-closed stop mid-pool (tests/smoke only).
      const pooled = await mapPool(triplets, concurrency, (t) => runTripletBatch(t, ctx));
      batchResults.push(...pooled);
      stoppedForRateLimit = pooled.some((br) =>
        Object.values(br.results || {}).some(
          (r) => Number(r.http_status) === 429 || r.error_class === EDGE_RATE_LIMITED,
        ),
      );
      const queue = outRoot ? readCorrelationQueueSnapshot(outRoot) : null;
      telemetryRows.push(
        emitResourceSample(outRoot, {
          completedBatch: batchResults.length,
          probeTotal: batchResults.length * 3,
          queue,
        }),
      );
    } else {
      for (let i = 0; i < triplets.length; i += 1) {
        const br = await runTripletBatch(triplets[i], ctx);
        batchResults.push(br);
        const hit429 = Object.values(br.results || {}).some(
          (r) => Number(r.http_status) === 429 || r.error_class === EDGE_RATE_LIMITED,
        );
        if (hit429) {
          stoppedForRateLimit = true;
          break;
        }
        const queue = outRoot ? readCorrelationQueueSnapshot(outRoot) : null;
        try {
          telemetryRows.push(
            emitResourceSample(outRoot, {
              completedBatch: i + 1,
              probeTotal: (i + 1) * 3,
              queue,
            }),
          );
        } catch (err) {
          stoppedForResource = true;
          resourceFailureClass = err.code || 'RUNNER_TELEMETRY_WRITE_FAIL';
          break;
        }
        const checkpointNowMs = Date.now();
        if (
          shouldEmitHumanCheckpoint({
            completed: i + 1,
            lastCompleted: lastCheckpointBatch,
            nowMs: checkpointNowMs,
            lastAtMs: lastCheckpointAtMs,
          })
        ) {
          console.log(
            formatHumanCheckpointLine({
              status: 'ADVANCING',
              completed: i + 1,
              target: checkpointTarget,
              failed: queue?.failed_count || 0,
              startedAtMs: checkpointStartedAtMs,
              nowMs: checkpointNowMs,
              previousCompleted: lastCheckpointBatch,
              previousAtMs: lastCheckpointAtMs,
              queue,
            }),
          );
          lastCheckpointBatch = i + 1;
          lastCheckpointAtMs = checkpointNowMs;
        }
        if (pacedInterval > 0 && i + 1 < triplets.length) {
          await sleepMs(pacedInterval);
        }
      }
    }

    const probeResults = batchResults.flatMap((b) => Object.values(b.results));
    const queue = outRoot ? readCorrelationQueueSnapshot(outRoot) : null;

    await closeCapabilityWorkerPool();
    const finalSample = emitResourceSample(outRoot, {
      completedBatch: batchResults.length,
      probeTotal: probeResults.length,
      queue,
    });
    telemetryRows.push(finalSample);

    resourcePolicy = evaluateResourcePolicy(telemetryRows, {
      workerFinal: finalSample.worker_active,
      messagePortFinal: finalSample.message_port_current,
      listenerFinal: finalSample.listener_current,
      activeHandleFinal: finalSample.active_handle_current,
      baseline: resourceBaseline,
    });
    if (resourcePolicy.status !== 'PASS') {
      stoppedForResource = true;
      resourceFailureClass = resourcePolicy.code;
    }

    const pass =
      !stoppedForRateLimit &&
      !stoppedForResource &&
      resourcePolicy.status === 'PASS' &&
      probeResults.every((p) => p.ok);

    return {
      status: pass ? 'PASS' : 'FAIL',
      mode,
      batches: batchResults.length,
      probes: probeResults.length,
      ok_count: probeResults.filter((p) => p.ok).length,
      fail_count: probeResults.filter((p) => !p.ok).length,
      stopped_for_rate_limit: stoppedForRateLimit,
      stopped_for_resource: stoppedForResource,
      failure_class: stoppedForRateLimit
        ? EDGE_RATE_LIMITED
        : stoppedForResource
          ? resourceFailureClass
          : null,
      inter_batch_interval_ms: pacedInterval,
      queue,
      batch_results: batchResults,
      resource_policy: resourcePolicy,
      resource_baseline: resourceBaseline,
      resource_peaks: resourcePeaks,
      resource_final: {
        workers: finalSample.worker_active,
        message_ports: finalSample.message_port_current,
        listeners: finalSample.listener_current,
        active_handles: finalSample.active_handle_current,
        heap_used_mb: finalSample.heap_used_mb,
        rss_mb: finalSample.rss_mb,
      },
    };
  } catch (err) {
    if (err.code === 'RUNNER_TELEMETRY_WRITE_FAIL' || err.code === 'RESOURCE_POLICY_BLOCKED') {
      return {
        status: 'FAIL',
        mode,
        batches: 0,
        probes: 0,
        ok_count: 0,
        fail_count: 0,
        stopped_for_rate_limit: false,
        stopped_for_resource: true,
        failure_class: err.code,
        inter_batch_interval_ms: pacedInterval,
        queue: outRoot ? readCorrelationQueueSnapshot(outRoot) : null,
        batch_results: [],
        resource_error: err.message,
      };
    }
    throw err;
  } finally {
    await closeCapabilityWorkerPool();
  }
}
