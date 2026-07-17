/**
 * Phase 34 bounded finalization and protocol-vs-queue acceptance.
 *
 * Queue COMPLETE means probes executed and evidence was recorded.
 * Protocol acceptance requires every protocol row to pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const FINAL_SUMMARY_MAX_BYTES = 5 * 1024 * 1024;

function emptyHttpCounters() {
  return {
    http_200: 0,
    http_422: 0,
    http_429: 0,
    http_502: 0,
    http_5xx: 0,
    http_0: 0,
    curl_failures: 0,
  };
}

function bumpHttp(counters, row) {
  const status = Number(row.http_status);
  if (status === 200) counters.http_200 += 1;
  else if (status === 422) counters.http_422 += 1;
  else if (status === 429) counters.http_429 += 1;
  else if (status === 502) {
    counters.http_502 += 1;
    counters.http_5xx += 1;
  } else if (Number.isFinite(status) && status >= 500) counters.http_5xx += 1;
  else if (status === 0 || row.http_status == null) counters.http_0 += 1;
  if (row.error_class === 'curl_exit' || String(row.error_class || '').startsWith('curl')) {
    counters.curl_failures += 1;
  }
}

/**
 * Evaluate protocol acceptance independently from queue execution status.
 */
export function evaluateProtocolAcceptance({
  queue = null,
  protocolRows = [],
  runner = null,
  materialParityFailures = 0,
} = {}) {
  const http = emptyHttpCounters();
  const byBatch = new Map();
  let protocolPass = 0;
  let protocolFail = 0;

  for (const row of protocolRows) {
    bumpHttp(http, row);
    if (row.ok) protocolPass += 1;
    else protocolFail += 1;
    const batchId = row.batch_id || 'unknown';
    if (!byBatch.has(batchId)) byBatch.set(batchId, []);
    byBatch.get(batchId).push(row);
  }

  let logicalPass = 0;
  let logicalFail = 0;
  for (const rows of byBatch.values()) {
    if (rows.every((r) => r.ok)) logicalPass += 1;
    else logicalFail += 1;
  }

  const queueComplete =
    queue?.complete_count ?? queue?.complete_total ?? byBatch.size;
  const queueFailed = queue?.failed_count ?? queue?.failed_total ?? 0;
  const runnerClaimedPass = runner?.status === 'PASS' || runner?.fail_count === 0;
  const pass =
    protocolFail === 0 &&
    logicalFail === 0 &&
    Number(materialParityFailures || 0) === 0 &&
    http.http_429 === 0 &&
    http.http_422 === 0 &&
    http.http_5xx === 0 &&
    http.http_0 === 0 &&
    http.curl_failures === 0;

  return {
    status: pass ? 'PASS' : 'BLOCKED',
    queue_complete: Number(queueComplete || 0),
    queue_failed: Number(queueFailed || 0),
    logical_sessions_complete: byBatch.size,
    logical_sessions_pass: logicalPass,
    logical_sessions_fail: logicalFail,
    protocol_rows_complete: protocolRows.length,
    protocol_rows_pass: protocolPass,
    protocol_rows_fail: protocolFail,
    material_parity_failures: Number(materialParityFailures || 0),
    failed_batches_misleading: Number(queueFailed || 0) === 0 && protocolFail > 0,
    runner_claimed_pass: Boolean(runnerClaimedPass),
    pass_impossible_with_protocol_failures: protocolFail > 0,
    ...http,
  };
}

function shardPath(outRoot, shard) {
  return path.join(outRoot, `shard-${shard}`, 'phase33f-matrix.jsonl');
}

/**
 * Stream matrix shards and collect bounded failure references only.
 */
export function streamMatrixFailureIndex(
  outRoot,
  {
    shards = ['h1', 'h2', 'h3'],
    onRow = null,
    maxFailureRefs = 200,
  } = {},
) {
  const http = emptyHttpCounters();
  const capability = Object.create(null);
  const protocol = { h1: { pass: 0, fail: 0 }, h2: { pass: 0, fail: 0 }, h3: { pass: 0, fail: 0 } };
  const byBatch = new Map();
  const failures = [];
  let protocolPass = 0;
  let protocolFail = 0;
  let total = 0;

  for (const shard of shards) {
    const file = shardPath(outRoot, shard);
    if (!fs.existsSync(file)) continue;
    // Line-oriented scan: avoid building a giant split array for 60k+ rows.
    const fd = fs.openSync(file, 'r');
    try {
      const bufferSize = 1024 * 1024;
      let carry = '';
      let lineNo = 0;
      let position = 0;
      const stat = fs.fstatSync(fd);
      while (position < stat.size) {
        const toRead = Math.min(bufferSize, stat.size - position);
        const buf = Buffer.allocUnsafe(toRead);
        const n = fs.readSync(fd, buf, 0, toRead, position);
        position += n;
        carry += buf.toString('utf8', 0, n);
        let nl;
        while ((nl = carry.indexOf('\n')) >= 0) {
          const line = carry.slice(0, nl);
          carry = carry.slice(nl + 1);
          lineNo += 1;
          if (!line.trim()) continue;
          let row;
          try {
            row = JSON.parse(line);
          } catch (err) {
            const e = new Error(`malformed detail row in shard-${shard} line ${lineNo}: ${err.message}`);
            e.code = 'PHASE34_MALFORMED_MATRIX_JSONL';
            e.details = { shard, line: lineNo, file };
            throw e;
          }
          total += 1;
          bumpHttp(http, row);
          const cap = row.capability || 'unknown';
          if (!capability[cap]) capability[cap] = { pass: 0, fail: 0 };
          const proto = row.protocol || shard;
          if (!protocol[proto]) protocol[proto] = { pass: 0, fail: 0 };
          if (row.ok) {
            protocolPass += 1;
            capability[cap].pass += 1;
            protocol[proto].pass += 1;
          } else {
            protocolFail += 1;
            capability[cap].fail += 1;
            protocol[proto].fail += 1;
            if (failures.length < maxFailureRefs) {
              failures.push({
                probe_id: row.probe_id,
                batch_id: row.batch_id,
                capability: row.capability,
                protocol: proto,
                http_status: row.http_status,
                error_class: row.error_class || null,
                started_at: row.started_at || null,
                finished_at: row.finished_at || null,
              });
            }
          }
          const batchId = row.batch_id || 'unknown';
          if (!byBatch.has(batchId)) byBatch.set(batchId, { pass: true, capability: row.capability });
          if (!row.ok) byBatch.get(batchId).pass = false;
          if (onRow) onRow(row);
        }
      }
      if (carry.trim()) {
        lineNo += 1;
        let row;
        try {
          row = JSON.parse(carry);
        } catch (err) {
          const e = new Error(`malformed detail row in shard-${shard} line ${lineNo}: ${err.message}`);
          e.code = 'PHASE34_MALFORMED_MATRIX_JSONL';
          e.details = { shard, line: lineNo, file };
          throw e;
        }
        total += 1;
        bumpHttp(http, row);
        const cap = row.capability || 'unknown';
        if (!capability[cap]) capability[cap] = { pass: 0, fail: 0 };
        const proto = row.protocol || shard;
        if (!protocol[proto]) protocol[proto] = { pass: 0, fail: 0 };
        if (row.ok) {
          protocolPass += 1;
          capability[cap].pass += 1;
          protocol[proto].pass += 1;
        } else {
          protocolFail += 1;
          capability[cap].fail += 1;
          protocol[proto].fail += 1;
          if (failures.length < maxFailureRefs) {
            failures.push({
              probe_id: row.probe_id,
              batch_id: row.batch_id,
              capability: row.capability,
              protocol: proto,
              http_status: row.http_status,
              error_class: row.error_class || null,
              started_at: row.started_at || null,
              finished_at: row.finished_at || null,
            });
          }
        }
        const batchId = row.batch_id || 'unknown';
        if (!byBatch.has(batchId)) byBatch.set(batchId, { pass: true, capability: row.capability });
        if (!row.ok) byBatch.get(batchId).pass = false;
        if (onRow) onRow(row);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  let logicalPass = 0;
  let logicalFail = 0;
  const capabilityLogical = Object.create(null);
  for (const meta of byBatch.values()) {
    const cap = meta.capability || 'unknown';
    if (!capabilityLogical[cap]) capabilityLogical[cap] = { pass: 0, fail: 0 };
    if (meta.pass) {
      logicalPass += 1;
      capabilityLogical[cap].pass += 1;
    } else {
      logicalFail += 1;
      capabilityLogical[cap].fail += 1;
    }
  }

  return {
    total,
    protocol_rows_pass: protocolPass,
    protocol_rows_fail: protocolFail,
    logical_sessions_complete: byBatch.size,
    logical_sessions_pass: logicalPass,
    logical_sessions_fail: logicalFail,
    http,
    capability_protocol: capability,
    capability_logical: capabilityLogical,
    protocol,
    failures,
  };
}

function readQueue(outRoot) {
  const p = path.join(outRoot, 'run-state', 'correlation-queue.json');
  if (!fs.existsSync(p)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      pending_count: doc.stats?.pending_count ?? doc.pending_count ?? 0,
      running_count: doc.stats?.running_count ?? doc.running_count ?? 0,
      complete_count: doc.stats?.complete_count ?? doc.complete_total ?? doc.complete_count ?? 0,
      failed_count: doc.stats?.failed_count ?? doc.failed_total ?? doc.failed_count ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Build acceptance counters from streamed shard aggregates (no full row materialization).
 */
export function acceptanceFromStreamed({ queue = null, streamed, runner = null } = {}) {
  const http = streamed.http || emptyHttpCounters();
  const protocolFail = streamed.protocol_rows_fail || 0;
  const logicalFail = streamed.logical_sessions_fail || 0;
  const pass =
    protocolFail === 0 &&
    logicalFail === 0 &&
    http.http_429 === 0 &&
    http.http_422 === 0 &&
    http.http_5xx === 0 &&
    http.http_0 === 0 &&
    http.curl_failures === 0;
  return {
    status: pass ? 'PASS' : 'BLOCKED',
    queue_complete: Number(queue?.complete_count || 0),
    queue_failed: Number(queue?.failed_count || 0),
    logical_sessions_complete: streamed.logical_sessions_complete,
    logical_sessions_pass: streamed.logical_sessions_pass,
    logical_sessions_fail: logicalFail,
    protocol_rows_complete: streamed.total,
    protocol_rows_pass: streamed.protocol_rows_pass,
    protocol_rows_fail: protocolFail,
    material_parity_failures: 0,
    failed_batches_misleading: Number(queue?.failed_count || 0) === 0 && protocolFail > 0,
    runner_claimed_pass: runner?.status === 'PASS' || runner?.fail_count === 0,
    pass_impossible_with_protocol_failures: protocolFail > 0,
    ...http,
  };
}

/**
 * Build a bounded finalization package from an evidence root.
 */
export function buildBoundedFinalization(
  outRoot,
  {
    expectedLogicalSessions = null,
    expectedProtocolRows = null,
    runnerSummary = null,
  } = {},
) {
  const queue = readQueue(outRoot);
  const streamed = streamMatrixFailureIndex(outRoot);
  const acceptance = acceptanceFromStreamed({ queue, streamed, runner: runnerSummary });

  if (expectedLogicalSessions != null && streamed.logical_sessions_complete !== expectedLogicalSessions) {
    acceptance.status = 'BLOCKED';
    acceptance.count_mismatch = true;
  }
  if (expectedProtocolRows != null && streamed.total !== expectedProtocolRows) {
    acceptance.status = 'BLOCKED';
    acceptance.count_mismatch = true;
  }

  const summary = {
    schema_version: 'phase34-bounded-final-summary-v1',
    at: new Date().toISOString(),
    out: outRoot,
    status: acceptance.status,
    queue,
    acceptance: {
      queue_complete: acceptance.queue_complete,
      queue_failed: acceptance.queue_failed,
      logical_sessions_complete: acceptance.logical_sessions_complete,
      logical_sessions_pass: acceptance.logical_sessions_pass,
      logical_sessions_fail: acceptance.logical_sessions_fail,
      protocol_rows_complete: acceptance.protocol_rows_complete,
      protocol_rows_pass: acceptance.protocol_rows_pass,
      protocol_rows_fail: acceptance.protocol_rows_fail,
      http_200: acceptance.http_200,
      http_422: acceptance.http_422,
      http_429: acceptance.http_429,
      http_502: acceptance.http_502,
      http_5xx: acceptance.http_5xx,
      http_0: acceptance.http_0,
      curl_failures: acceptance.curl_failures,
      material_parity_failures: acceptance.material_parity_failures,
      failed_batches_misleading: acceptance.failed_batches_misleading,
      pass_impossible_with_protocol_failures: acceptance.pass_impossible_with_protocol_failures,
    },
    expected: {
      logical_sessions: expectedLogicalSessions,
      protocol_rows: expectedProtocolRows,
    },
    runner: runnerSummary,
    failure_ref_count: streamed.failures.length,
    artifact_paths: {
      final_summary: 'reports/final-summary.json',
      final_capability_metrics: 'reports/final-capability-metrics.json',
      final_protocol_metrics: 'reports/final-protocol-metrics.json',
      final_failure_index: 'reports/final-failure-index.jsonl',
      artifact_index: 'reports/artifact-index.json',
    },
  };

  return {
    summary,
    acceptance,
    capabilityMetrics: {
      protocol: streamed.capability_protocol,
      logical: streamed.capability_logical,
    },
    protocolMetrics: streamed.protocol,
    failures: streamed.failures,
  };
}

function writeAtomicJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > FINAL_SUMMARY_MAX_BYTES && filePath.endsWith('final-summary.json')) {
    const err = new Error(`final-summary.json exceeds ${FINAL_SUMMARY_MAX_BYTES} bytes`);
    err.code = 'PHASE34_FINAL_SUMMARY_TOO_LARGE';
    throw err;
  }
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function writeBoundedFinalizationReports(outRoot, built) {
  const reports = path.join(outRoot, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const summaryPath = path.join(reports, 'final-summary.json');
  const capabilityPath = path.join(reports, 'final-capability-metrics.json');
  const protocolPath = path.join(reports, 'final-protocol-metrics.json');
  const failureIndexPath = path.join(reports, 'final-failure-index.jsonl');
  const artifactIndexPath = path.join(reports, 'artifact-index.json');

  writeAtomicJson(summaryPath, built.summary);
  writeAtomicJson(capabilityPath, built.capabilityMetrics);
  writeAtomicJson(protocolPath, built.protocolMetrics);

  const failTmp = `${failureIndexPath}.tmp-${process.pid}`;
  fs.writeFileSync(
    failTmp,
    built.failures.map((f) => JSON.stringify(f)).join('\n') + (built.failures.length ? '\n' : ''),
    'utf8',
  );
  fs.renameSync(failTmp, failureIndexPath);

  const artifactIndex = {
    at: new Date().toISOString(),
    files: [summaryPath, capabilityPath, protocolPath, failureIndexPath].map((p) => ({
      path: path.relative(outRoot, p),
      sha256: createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
      bytes: fs.statSync(p).size,
    })),
  };
  writeAtomicJson(artifactIndexPath, artifactIndex);

  return {
    summaryPath,
    capabilityPath,
    protocolPath,
    failureIndexPath,
    artifactIndexPath,
    summaryBytes: fs.statSync(summaryPath).size,
  };
}

/**
 * Async streaming variant for very large shards (optional soak path).
 */
export async function streamMatrixFailureIndexAsync(outRoot, { shards = ['h1', 'h2', 'h3'] } = {}) {
  // Prefer sync path for determinism in tests; async available for soak harnesses.
  return streamMatrixFailureIndex(outRoot, { shards });
}
