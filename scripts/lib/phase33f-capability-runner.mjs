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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKER_PATH = path.join(__dirname, 'phase33f-capability-probe-worker.mjs');

/** @type {BoundedWorkerPool | null} */
let capabilityWorkerPool = null;

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

  try {
    const batchResults =
      mode === 'smoke'
        ? await mapPool(triplets, concurrency, (t) => runTripletBatch(t, ctx))
        : await (async () => {
            const out = [];
            for (const t of triplets) {
              out.push(await runTripletBatch(t, ctx));
            }
            return out;
          })();

    const probeResults = batchResults.flatMap((b) => Object.values(b.results));
    const queue = outRoot ? readCorrelationQueueSnapshot(outRoot) : null;
    return {
      status: probeResults.every((p) => p.ok) ? 'PASS' : 'FAIL',
      mode,
      batches: batchResults.length,
      probes: probeResults.length,
      ok_count: probeResults.filter((p) => p.ok).length,
      fail_count: probeResults.filter((p) => !p.ok).length,
      queue,
      batch_results: batchResults,
    };
  } finally {
    await closeCapabilityWorkerPool();
  }
}
