/**
 * Phase 32H-R1 — durable triplet correlation job queue with crash-safe recovery.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { batchIndexPath } from './phase32h-batch-packet-index.mjs';
import { probeIndexPath } from './phase32h-probe-packet-index.mjs';
import { isEvidenceRootFrozen, readLaunchHead, readRunId } from './phase32h-run-integrity.mjs';

export const CORRELATION_BACKLOG_LIMIT = Number(process.env.PHASE32H_CORRELATION_BACKLOG_LIMIT || 50);
export const CORRELATION_QUEUE_SCHEMA_VERSION = 1;
export const CORRELATION_QUEUE_BLOCKED_MARKER = 'PHASE32H_CORRELATION_QUEUE_BLOCKED';
export const JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
});

export function correlationQueuePath(outRoot) {
  return path.join(outRoot, 'run-state', 'correlation-queue.json');
}

export function correlationQueueBlockedMarkerPath(outRoot) {
  return path.join(outRoot, 'run-state', CORRELATION_QUEUE_BLOCKED_MARKER);
}

export function legacyCorrelationBacklogPath(outRoot) {
  return path.join(outRoot, 'run-state', 'correlation-backlog.json');
}

export function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function redactErrorMessage(message) {
  return String(message || 'unknown')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .slice(0, 500);
}

function assertQueueWritable(outRoot) {
  if (isEvidenceRootFrozen(outRoot)) {
    throw new Error(`correlation queue write rejected: frozen root ${outRoot}`);
  }
  if (fs.existsSync(correlationQueueBlockedMarkerPath(outRoot))) {
    const err = new Error('correlation queue blocked');
    err.code = CORRELATION_QUEUE_BLOCKED_MARKER;
    throw err;
  }
}

export function writeQueueBlockedMarker(outRoot, reason) {
  const file = correlationQueueBlockedMarkerPath(outRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ blocked_at: new Date().toISOString(), reason: redactErrorMessage(reason) }, null, 2)}\n`,
    'utf8',
  );
  return file;
}

function atomicWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function recomputeQueueStats(queue) {
  const jobs = queue.jobs || [];
  const stats = {
    pending_count: 0,
    running_count: 0,
    complete_count: 0,
    failed_count: 0,
    unresolved_count: 0,
    oldest_pending_age_ms: null,
    oldest_pending_enqueued_at: null,
  };
  const now = Date.now();
  for (const job of jobs) {
    if (job.status === JOB_STATUS.PENDING) {
      stats.pending_count += 1;
      stats.unresolved_count += 1;
      const age = now - Date.parse(job.enqueued_at || job.enqueue_timestamp || 0);
      if (stats.oldest_pending_age_ms == null || age > stats.oldest_pending_age_ms) {
        stats.oldest_pending_age_ms = age;
        stats.oldest_pending_enqueued_at = job.enqueued_at || job.enqueue_timestamp;
      }
    } else if (job.status === JOB_STATUS.RUNNING) {
      stats.running_count += 1;
      stats.unresolved_count += 1;
    } else if (job.status === JOB_STATUS.COMPLETE) {
      stats.complete_count += 1;
    } else if (job.status === JOB_STATUS.FAILED) {
      stats.failed_count += 1;
    }
  }
  queue.stats = stats;
  return stats;
}

export function validateQueueSchema(queue, { runId, launchHead, manifestSha } = {}) {
  if (!queue || typeof queue !== 'object') {
    throw new Error('correlation queue missing or not an object');
  }
  if (queue.schema_version !== CORRELATION_QUEUE_SCHEMA_VERSION) {
    throw new Error(`unsupported correlation queue schema_version=${queue.schema_version}`);
  }
  if (!Array.isArray(queue.jobs)) {
    throw new Error('correlation queue jobs must be an array');
  }
  if (runId && queue.run_id && queue.run_id !== runId) {
    throw new Error(`correlation queue run_id mismatch: ${queue.run_id} != ${runId}`);
  }
  if (launchHead && queue.launch_head && queue.launch_head !== launchHead) {
    throw new Error('correlation queue launch_head mismatch');
  }
  if (manifestSha && queue.manifest_sha && queue.manifest_sha !== manifestSha) {
    throw new Error('correlation queue manifest_sha mismatch');
  }
  const seenJobIds = new Set();
  const seenBatchIds = new Set();
  for (const job of queue.jobs) {
    for (const field of ['job_id', 'batch_id', 'status', 'run_id', 'launch_head', 'manifest_sha']) {
      if (job[field] == null || job[field] === '') {
        throw new Error(`correlation job missing ${field}`);
      }
    }
    if (!Object.values(JOB_STATUS).includes(job.status)) {
      throw new Error(`invalid job status ${job.status}`);
    }
    if (seenJobIds.has(job.job_id)) throw new Error(`duplicate job_id ${job.job_id}`);
    if (seenBatchIds.has(job.batch_id)) throw new Error(`duplicate batch_id ${job.batch_id}`);
    seenJobIds.add(job.job_id);
    seenBatchIds.add(job.batch_id);
    if (runId && job.run_id !== runId) throw new Error(`job run_id mismatch for ${job.job_id}`);
    if (launchHead && job.launch_head !== launchHead) throw new Error(`job launch_head mismatch for ${job.job_id}`);
    if (manifestSha && job.manifest_sha !== manifestSha) {
      throw new Error(`job manifest_sha mismatch for ${job.job_id}`);
    }
  }
  return true;
}

export function readCorrelationQueue(outRoot, context = {}) {
  const file = correlationQueuePath(outRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) throw new Error('empty correlation queue file');
    const queue = JSON.parse(raw);
    validateQueueSchema(queue, context);
    recomputeQueueStats(queue);
    return queue;
  } catch (err) {
    writeQueueBlockedMarker(outRoot, err.message);
    const blocked = new Error(`correlation queue read failed: ${err.message}`);
    blocked.code = CORRELATION_QUEUE_BLOCKED_MARKER;
    throw blocked;
  }
}

export function writeCorrelationQueue(outRoot, queue) {
  assertQueueWritable(outRoot);
  recomputeQueueStats(queue);
  validateQueueSchema(queue, {
    runId: queue.run_id,
    launchHead: queue.launch_head,
    manifestSha: queue.manifest_sha,
  });
  atomicWriteJson(correlationQueuePath(outRoot), queue);
  return queue;
}

export function initCorrelationQueue(outRoot, { runId, launchHead, manifestSha }) {
  assertQueueWritable(outRoot);
  const existing = fs.existsSync(correlationQueuePath(outRoot))
    ? readCorrelationQueue(outRoot, { runId, launchHead, manifestSha })
    : null;
  if (existing) return existing;
  const queue = {
    schema_version: CORRELATION_QUEUE_SCHEMA_VERSION,
    run_id: runId,
    launch_head: launchHead,
    manifest_sha: manifestSha,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    jobs: [],
    stats: {},
    metrics: {
      enqueue_rate_jobs_per_minute: null,
      drain_rate_jobs_per_minute: null,
      last_drain_at: null,
      last_enqueue_at: null,
    },
  };
  recomputeQueueStats(queue);
  writeCorrelationQueue(outRoot, queue);
  return queue;
}

export function ensureCorrelationQueue(outRoot, { runId, launchHead, manifestSha }) {
  const queue = readCorrelationQueue(outRoot, { runId, launchHead, manifestSha });
  if (queue) return queue;
  return initCorrelationQueue(outRoot, { runId, launchHead, manifestSha });
}

export function jobIdForBatch(batchId) {
  return `corr-${batchId}`;
}

export function buildExpectedOutputPaths(outRoot, batchId, expectedProbeIds) {
  const probePaths = {};
  for (const [proto, probeId] of Object.entries(expectedProbeIds || {})) {
    probePaths[proto] = probeIndexPath(outRoot, probeId);
  }
  return {
    probe: probePaths,
    batch: batchIndexPath(outRoot, batchId),
  };
}

export function hashOutputPaths(outputPaths) {
  const hashes = { probe: {}, batch: null };
  for (const [proto, file] of Object.entries(outputPaths.probe || {})) {
    if (!fs.existsSync(file)) {
      throw new Error(`missing probe index for ${proto}: ${file}`);
    }
    hashes.probe[proto] = sha256FileSync(file);
  }
  if (!fs.existsSync(outputPaths.batch)) {
    throw new Error(`missing batch index: ${outputPaths.batch}`);
  }
  hashes.batch = sha256FileSync(outputPaths.batch);
  return hashes;
}

export function verifyCorrelationJobOutputs(outRoot, job) {
  const outputPaths = job.output_paths || buildExpectedOutputPaths(outRoot, job.batch_id, job.expected_probe_ids);
  const outputHashes = hashOutputPaths(outputPaths);
  if (job.output_hashes?.batch && job.output_hashes.batch !== outputHashes.batch) {
    throw new Error(`batch index hash mismatch for ${job.batch_id}`);
  }
  for (const [proto, hash] of Object.entries(outputHashes.probe)) {
    if (job.output_hashes?.probe?.[proto] && job.output_hashes.probe[proto] !== hash) {
      throw new Error(`probe index hash mismatch for ${proto} batch ${job.batch_id}`);
    }
  }
  const batchRecord = JSON.parse(fs.readFileSync(outputPaths.batch, 'utf8'));
  if (batchRecord.batch_id !== job.batch_id) {
    throw new Error(`batch index batch_id mismatch for ${job.batch_id}`);
  }
  for (const [proto, probeId] of Object.entries(job.expected_probe_ids || {})) {
    const probeRecord = JSON.parse(fs.readFileSync(outputPaths.probe[proto], 'utf8'));
    if (Number(probeRecord.probe_id) !== Number(probeId)) {
      throw new Error(`probe index probe_id mismatch for ${proto}`);
    }
    if (probeRecord.batch_id !== job.batch_id) {
      throw new Error(`probe index batch_id mismatch for ${proto}`);
    }
  }
  return { outputPaths, outputHashes };
}

export function enqueueCorrelationJob(
  outRoot,
  {
    batchId,
    runId,
    launchHead,
    manifestSha,
    expectedProbeIds,
    outputPaths = null,
    outputHashes = null,
  },
) {
  assertQueueWritable(outRoot);
  const queue = ensureCorrelationQueue(outRoot, { runId, launchHead, manifestSha });
  const existing = queue.jobs.find((j) => j.batch_id === batchId);
  if (existing) {
    if (existing.status === JOB_STATUS.FAILED) {
      throw new Error(`correlation job failed for batch ${batchId}`);
    }
    return { job: existing, created: false, pending: queue.stats.unresolved_count };
  }

  const paths = outputPaths || buildExpectedOutputPaths(outRoot, batchId, expectedProbeIds);
  const job = {
    job_id: jobIdForBatch(batchId),
    batch_id: batchId,
    run_id: runId,
    launch_head: launchHead,
    manifest_sha: manifestSha,
    status: JOB_STATUS.PENDING,
    enqueued_at: new Date().toISOString(),
    enqueue_timestamp: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    attempt_count: 0,
    expected_probe_ids: expectedProbeIds,
    output_paths: paths,
    output_hashes: outputHashes,
    error_class: null,
    error_message_redacted: null,
  };
  queue.jobs.push(job);
  queue.updated_at = new Date().toISOString();
  queue.metrics.last_enqueue_at = queue.updated_at;
  writeCorrelationQueue(outRoot, queue);
  return { job, created: true, pending: recomputeQueueStats(queue).unresolved_count };
}

export function claimCorrelationJob(outRoot, jobId) {
  const queue = readCorrelationQueue(outRoot);
  if (!queue) throw new Error('correlation queue missing');
  const job = queue.jobs.find((j) => j.job_id === jobId);
  if (!job) throw new Error(`correlation job not found: ${jobId}`);
  if (job.status === JOB_STATUS.COMPLETE) return job;
  if (job.status === JOB_STATUS.FAILED) throw new Error(`correlation job failed: ${jobId}`);
  if (job.status === JOB_STATUS.RUNNING) return job;
  if (job.status !== JOB_STATUS.PENDING) throw new Error(`cannot claim job in status ${job.status}`);
  job.status = JOB_STATUS.RUNNING;
  job.started_at = new Date().toISOString();
  job.attempt_count = (job.attempt_count || 0) + 1;
  writeCorrelationQueue(outRoot, queue);
  return job;
}

export function completeCorrelationJob(outRoot, jobId) {
  const queue = readCorrelationQueue(outRoot);
  if (!queue) throw new Error('correlation queue missing');
  const job = queue.jobs.find((j) => j.job_id === jobId);
  if (!job) throw new Error(`correlation job not found: ${jobId}`);
  if (job.status === JOB_STATUS.COMPLETE) return job;
  if (job.status !== JOB_STATUS.RUNNING && job.status !== JOB_STATUS.PENDING) {
    throw new Error(`cannot complete job in status ${job.status}`);
  }
  if (job.status === JOB_STATUS.PENDING) {
    job.status = JOB_STATUS.RUNNING;
    job.started_at = job.started_at || new Date().toISOString();
    job.attempt_count = (job.attempt_count || 0) + 1;
  }
  const verified = verifyCorrelationJobOutputs(outRoot, job);
  job.output_paths = verified.outputPaths;
  job.output_hashes = verified.outputHashes;
  job.status = JOB_STATUS.COMPLETE;
  job.completed_at = new Date().toISOString();
  job.error_class = null;
  job.error_message_redacted = null;
  writeCorrelationQueue(outRoot, queue);
  return job;
}

export function failCorrelationJob(outRoot, jobId, { errorClass, message }) {
  const queue = readCorrelationQueue(outRoot);
  if (!queue) throw new Error('correlation queue missing');
  const job = queue.jobs.find((j) => j.job_id === jobId);
  if (!job) throw new Error(`correlation job not found: ${jobId}`);
  if (job.status === JOB_STATUS.COMPLETE) throw new Error(`cannot fail completed job ${jobId}`);
  job.status = JOB_STATUS.FAILED;
  job.completed_at = new Date().toISOString();
  job.error_class = errorClass || 'CORRELATION_FAILURE';
  job.error_message_redacted = redactErrorMessage(message);
  writeCorrelationQueue(outRoot, queue);
  return job;
}

export function correlationBacklogBlocksLaunch(outRoot) {
  if (fs.existsSync(correlationQueueBlockedMarkerPath(outRoot))) return true;
  if (fs.existsSync(correlationQueuePath(outRoot))) {
    const queue = readCorrelationQueue(outRoot);
    if (queue.stats.failed_count > 0) return true;
    return queue.stats.unresolved_count > CORRELATION_BACKLOG_LIMIT;
  }
  return readLegacyBacklogCount(outRoot) > CORRELATION_BACKLOG_LIMIT;
}

export function readLegacyBacklogCount(outRoot) {
  const file = legacyCorrelationBacklogPath(outRoot);
  if (!fs.existsSync(file)) return 0;
  const backlog = JSON.parse(fs.readFileSync(file, 'utf8'));
  return backlog.pending ?? backlog.batches?.length ?? 0;
}

export function processCorrelationJob(outRoot, jobId) {
  const queue = readCorrelationQueue(outRoot);
  const job = queue?.jobs.find((j) => j.job_id === jobId);
  if (!job) throw new Error(`correlation job not found: ${jobId}`);
  if (job.status === JOB_STATUS.COMPLETE) return job;
  if (job.status === JOB_STATUS.FAILED) throw new Error(`correlation job failed: ${jobId}`);
  if (job.status === JOB_STATUS.PENDING) claimCorrelationJob(outRoot, jobId);
  return completeCorrelationJob(outRoot, jobId);
}

export function drainCorrelationQueue(outRoot, { maxJobs = Infinity, runId, launchHead, manifestSha } = {}) {
  const resolvedRunId = runId || readRunId(outRoot);
  const resolvedLaunchHead = launchHead || readLaunchHead(outRoot);
  ensureCorrelationQueue(outRoot, {
    runId: resolvedRunId,
    launchHead: resolvedLaunchHead,
    manifestSha,
  });
  const context = { runId: resolvedRunId, launchHead: resolvedLaunchHead, manifestSha };
  recoverStaleRunningJobs(outRoot, context);
  const refreshed = readCorrelationQueue(outRoot, context);
  const pending = refreshed.jobs.filter(
    (j) => j.status === JOB_STATUS.PENDING || j.status === JOB_STATUS.RUNNING,
  );
  const started = Date.now();
  let processed = 0;
  for (const job of pending.slice(0, maxJobs)) {
    processCorrelationJob(outRoot, job.job_id);
    processed += 1;
  }
  const elapsedMin = Math.max((Date.now() - started) / 60_000, 1 / 60);
  const finalQueue = readCorrelationQueue(outRoot, context);
  finalQueue.metrics.drain_rate_jobs_per_minute = Number((processed / elapsedMin).toFixed(4));
  finalQueue.metrics.last_drain_at = new Date().toISOString();
  writeCorrelationQueue(outRoot, finalQueue);
  return { processed, stats: finalQueue.stats };
}

export function serviceCorrelationQueueBeforeBatch(outRoot, context = {}) {
  const runId = context.runId || readRunId(outRoot);
  const launchHead = context.launchHead || readLaunchHead(outRoot);
  const manifestSha = context.manifestSha;
  recoverStaleRunningJobs(outRoot, { runId, launchHead, manifestSha });
  return drainCorrelationQueue(outRoot, { runId, launchHead, manifestSha });
}

export function recoverStaleRunningJobs(outRoot, context = {}) {
  if (!fs.existsSync(correlationQueuePath(outRoot))) return { recovered: 0, completed: 0, requeued: 0 };
  const queue = readCorrelationQueue(outRoot, context);
  let recovered = 0;
  let completed = 0;
  let requeued = 0;
  for (const job of queue.jobs) {
    if (job.status !== JOB_STATUS.RUNNING) continue;
    recovered += 1;
    try {
      const verified = verifyCorrelationJobOutputs(outRoot, job);
      job.output_paths = verified.outputPaths;
      job.output_hashes = verified.outputHashes;
      job.status = JOB_STATUS.COMPLETE;
      job.completed_at = new Date().toISOString();
      completed += 1;
    } catch {
      job.status = JOB_STATUS.PENDING;
      job.started_at = null;
      job.attempt_count = (job.attempt_count || 0) + 1;
      requeued += 1;
    }
  }
  if (recovered > 0) writeCorrelationQueue(outRoot, queue);
  return { recovered, completed, requeued };
}

export function finalizeTripletCorrelationJob(
  outRoot,
  {
    batchId,
    runId,
    launchHead,
    manifestSha,
    expectedProbeIds,
  },
) {
  const enqueueResult = enqueueCorrelationJob(outRoot, {
    batchId,
    runId,
    launchHead,
    manifestSha,
    expectedProbeIds,
  });
  return processCorrelationJob(outRoot, enqueueResult.job.job_id);
}

export function readCorrelationQueueSnapshot(outRoot) {
  if (!fs.existsSync(correlationQueuePath(outRoot))) {
    return {
      pending_count: readLegacyBacklogCount(outRoot),
      running_count: 0,
      complete_count: 0,
      failed_count: 0,
      legacy_backlog_only: true,
    };
  }
  const queue = readCorrelationQueue(outRoot);
  return { ...queue.stats, legacy_backlog_only: false };
}

export function classifyLegacyBacklogFixture({
  outRoot,
  legacyBacklog,
  probeIndexCount,
  batchIndexCount,
}) {
  const pending = legacyBacklog?.pending ?? legacyBacklog?.batches?.length ?? 0;
  const indexesComplete = probeIndexCount === batchIndexCount * 3;
  const classification =
    pending > CORRELATION_BACKLOG_LIMIT && indexesComplete
      ? 'LEGACY_ENQUEUE_WITHOUT_DRAIN'
      : pending > 0 && !indexesComplete
        ? 'LEGACY_INCOMPLETE_CORRELATION'
        : pending === 0
          ? 'LEGACY_EMPTY'
          : 'LEGACY_PENDING_WITH_INDEXES';
  return {
    classification,
    pending,
    limit: CORRELATION_BACKLOG_LIMIT,
    probe_index_count: probeIndexCount,
    batch_index_count: batchIndexCount,
    indexes_complete: indexesComplete,
    data_lost: false,
    duplicate_processing_risk: true,
    repair_required: 'durable_queue_with_complete_transition',
    out_root: outRoot,
    read_only: true,
  };
}

export function correlationBacklogPath(outRoot) {
  return legacyCorrelationBacklogPath(outRoot);
}

export function readCorrelationBacklog(outRoot) {
  const legacy = legacyCorrelationBacklogPath(outRoot);
  if (!fs.existsSync(legacy)) return { pending: 0, batches: [] };
  return JSON.parse(fs.readFileSync(legacy, 'utf8'));
}
