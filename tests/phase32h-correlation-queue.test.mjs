import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { batchIndexPath, writeBatchPacketIndex } from '../scripts/lib/phase32h-batch-packet-index.mjs';
import {
  CORRELATION_BACKLOG_LIMIT,
  CORRELATION_QUEUE_BLOCKED_MARKER,
  JOB_STATUS,
  claimCorrelationJob,
  classifyLegacyBacklogFixture,
  completeCorrelationJob,
  correlationBacklogBlocksLaunch,
  correlationQueueBlockedMarkerPath,
  correlationQueuePath,
  drainCorrelationQueue,
  enqueueCorrelationJob,
  failCorrelationJob,
  finalizeTripletCorrelationJob,
  initCorrelationQueue,
  processCorrelationJob,
  readCorrelationQueue,
  recoverStaleRunningJobs,
  recomputeQueueStats,
  serviceCorrelationQueueBeforeBatch,
  verifyCorrelationJobOutputs,
  writeCorrelationQueue,
  writeQueueBlockedMarker,
} from '../scripts/lib/phase32h-correlation-queue.mjs';
import { probeIndexPath, writeProbePacketIndex } from '../scripts/lib/phase32h-probe-packet-index.mjs';
import { initRunState } from '../scripts/lib/phase32h-run-integrity.mjs';

const RUN_ID = 'phase32h-test-run';
const LAUNCH_HEAD = 'abc123def4567890abcdef1234567890abcdef12';
const MANIFEST_SHA = crypto.createHash('sha256').update('manifest').digest('hex');

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-corr-queue-'));
  fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
  initRunState(root, {
    runId: RUN_ID,
    launchHead: LAUNCH_HEAD,
    evidenceLabel: 'test',
    manifestPath: path.join(root, 'phase32h-r1-manifest.jsonl'),
  });
  fs.writeFileSync(path.join(root, 'phase32h-r1-manifest.jsonl'), '{}\n', 'utf8');
  initCorrelationQueue(root, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA });
  return root;
}

function writeIndexes(outRoot, batchId, probeIds) {
  writeBatchPacketIndex(outRoot, {
    batch_id: batchId,
    run_id: RUN_ID,
    member_probe_ids: probeIds,
    coordinate: { case_id: 'auction_pressure', window: 1, run: 1, user_uid: 'u1', user_class: 'real_participant' },
    start_spread_ms: 1,
    batch_timing_status: 'PASS',
    packet_correlation_status: 'PENDING',
  });
  for (const [proto, probeId] of Object.entries(probeIds)) {
    writeProbePacketIndex(outRoot, probeId, {
      probe_id: probeId,
      batch_id: batchId,
      protocol: proto,
      run_id: RUN_ID,
      launch_head: LAUNCH_HEAD,
      correlation_status: 'PARTIAL',
    });
  }
}

function finalizeBatch(outRoot, batchNum) {
  const batchId = `batch-test-${batchNum}`;
  const probeIds = { h1: batchNum * 10 + 1, h2: batchNum * 10 + 2, h3: batchNum * 10 + 3 };
  writeIndexes(outRoot, batchId, probeIds);
  return finalizeTripletCorrelationJob(outRoot, {
    batchId,
    runId: RUN_ID,
    launchHead: LAUNCH_HEAD,
    manifestSha: MANIFEST_SHA,
    expectedProbeIds: probeIds,
  });
}

describe('phase32h correlation queue', () => {
  let root;

  beforeEach(() => {
    root = mkRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('one batch enqueues and completes one job', () => {
    const job = finalizeBatch(root, 1);
    assert.equal(job.status, JOB_STATUS.COMPLETE);
    const queue = readCorrelationQueue(root);
    assert.equal(queue.stats.complete_count, 1);
    assert.equal(queue.stats.unresolved_count, 0);
  });

  it('COMPLETE jobs do not count as backlog', () => {
    finalizeBatch(root, 1);
    finalizeBatch(root, 2);
    const queue = readCorrelationQueue(root);
    assert.equal(queue.stats.complete_count, 2);
    assert.equal(queue.stats.unresolved_count, 0);
    assert.equal(correlationBacklogBlocksLaunch(root), false);
  });

  it('60 sequential triplet batches finish with pending=0', () => {
    for (let i = 1; i <= 60; i += 1) finalizeBatch(root, i);
    const queue = readCorrelationQueue(root);
    assert.equal(queue.stats.complete_count, 60);
    assert.equal(queue.stats.pending_count, 0);
    assert.equal(queue.stats.running_count, 0);
  });

  it('100 sequential batches finish without hitting limit', () => {
    for (let i = 1; i <= 100; i += 1) finalizeBatch(root, i);
    const queue = readCorrelationQueue(root);
    assert.equal(queue.stats.complete_count, 100);
    assert.equal(correlationBacklogBlocksLaunch(root), false);
  });

  it('verifies three probe indexes and one batch index per job', () => {
    const job = finalizeBatch(root, 7);
    const verified = verifyCorrelationJobOutputs(root, job);
    assert.equal(Object.keys(verified.outputHashes.probe).length, 3);
    assert.ok(verified.outputHashes.batch);
  });

  it('duplicate enqueue is idempotent', () => {
    const batchId = 'batch-dup';
    const probeIds = { h1: 11, h2: 12, h3: 13 };
    writeIndexes(root, batchId, probeIds);
    const first = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    const second = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(readCorrelationQueue(root).jobs.length, 1);
  });

  it('duplicate completion is idempotent', () => {
    const job = finalizeBatch(root, 3);
    const again = completeCorrelationJob(root, job.job_id);
    assert.equal(again.status, JOB_STATUS.COMPLETE);
    assert.equal(readCorrelationQueue(root).stats.complete_count, 1);
  });

  it('missing probe index prevents COMPLETE', () => {
    const batchId = 'batch-missing-probe';
    const probeIds = { h1: 21, h2: 22, h3: 23 };
    writeBatchPacketIndex(root, {
      batch_id: batchId,
      run_id: RUN_ID,
      member_probe_ids: probeIds,
      coordinate: { case_id: 'c', window: 1, run: 1 },
      start_spread_ms: 1,
      batch_timing_status: 'PASS',
    });
    writeProbePacketIndex(root, probeIds.h1, { probe_id: probeIds.h1, batch_id: batchId, run_id: RUN_ID });
    writeProbePacketIndex(root, probeIds.h2, { probe_id: probeIds.h2, batch_id: batchId, run_id: RUN_ID });
    const enq = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    assert.throws(() => processCorrelationJob(root, enq.job.job_id), /missing probe index/);
  });

  it('malformed batch index prevents COMPLETE', () => {
    const batchId = 'batch-bad';
    const probeIds = { h1: 31, h2: 32, h3: 33 };
    writeIndexes(root, batchId, probeIds);
    const badPath = batchIndexPath(root, batchId);
    fs.writeFileSync(badPath, '{}\n', 'utf8');
    const enq = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    assert.throws(() => processCorrelationJob(root, enq.job.job_id), /batch_id mismatch|missing/);
  });

  it('output hash mismatch prevents COMPLETE', () => {
    const batchId = 'batch-hash';
    const probeIds = { h1: 41, h2: 42, h3: 43 };
    writeIndexes(root, batchId, probeIds);
    const enq = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
      outputHashes: { probe: { h1: 'bad', h2: 'bad', h3: 'bad' }, batch: 'bad' },
    });
    assert.throws(() => processCorrelationJob(root, enq.job.job_id), /hash mismatch/);
  });

  it('stale RUNNING job with valid outputs recovers to COMPLETE', () => {
    const job = finalizeBatch(root, 5);
    const queue = readCorrelationQueue(root);
    const stored = queue.jobs.find((j) => j.job_id === job.job_id);
    stored.status = JOB_STATUS.RUNNING;
    stored.completed_at = null;
    writeCorrelationQueue(root, queue);
    const result = recoverStaleRunningJobs(root);
    assert.equal(result.completed, 1);
    assert.equal(readCorrelationQueue(root).stats.complete_count, 1);
  });

  it('stale RUNNING job with missing outputs returns to PENDING', () => {
    const batchId = 'batch-stale';
    const probeIds = { h1: 51, h2: 52, h3: 53 };
    writeIndexes(root, batchId, probeIds);
    const enq = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    claimCorrelationJob(root, enq.job.job_id);
    fs.rmSync(probeIndexPath(root, probeIds.h3));
    const result = recoverStaleRunningJobs(root);
    assert.equal(result.requeued, 1);
    assert.equal(readCorrelationQueue(root).jobs[0].status, JOB_STATUS.PENDING);
  });

  it('failed job remains visible and blocks launch', () => {
    const batchId = 'batch-fail';
    const probeIds = { h1: 61, h2: 62, h3: 63 };
    writeIndexes(root, batchId, probeIds);
    const enq = enqueueCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    failCorrelationJob(root, enq.job.job_id, { errorClass: 'TEST', message: 'forced' });
    assert.equal(correlationBacklogBlocksLaunch(root), true);
  });

  it('queue writes are atomic via rename', () => {
    finalizeBatch(root, 8);
    const file = correlationQueuePath(root);
    assert.ok(fs.existsSync(file));
    assert.equal(fs.readdirSync(path.join(root, 'run-state')).some((n) => n.includes('.tmp-')), false);
  });

  it('truncated queue file fails closed', () => {
    fs.writeFileSync(correlationQueuePath(root), '', 'utf8');
    assert.throws(() => readCorrelationQueue(root), /correlation queue read failed/);
    assert.ok(fs.existsSync(correlationQueueBlockedMarkerPath(root)));
  });

  it('another run_id is rejected on read', () => {
    finalizeBatch(root, 9);
    assert.throws(
      () => readCorrelationQueue(root, { runId: 'other-run', launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA }),
      /run_id mismatch/,
    );
  });

  it('another launch HEAD is rejected on read', () => {
    finalizeBatch(root, 10);
    assert.throws(
      () => readCorrelationQueue(root, { runId: RUN_ID, launchHead: 'deadbeef', manifestSha: MANIFEST_SHA }),
      /launch_head mismatch/,
    );
  });

  it('another manifest SHA is rejected on read', () => {
    finalizeBatch(root, 11);
    assert.throws(
      () => readCorrelationQueue(root, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: 'bad' }),
      /manifest_sha mismatch/,
    );
  });

  it('backlog at limit blocks before a new application batch', () => {
    for (let i = 1; i <= CORRELATION_BACKLOG_LIMIT + 1; i += 1) {
      const batchId = `batch-pend-${i}`;
      const probeIds = { h1: i * 3, h2: i * 3 + 1, h3: i * 3 + 2 };
      enqueueCorrelationJob(root, {
        batchId,
        runId: RUN_ID,
        launchHead: LAUNCH_HEAD,
        manifestSha: MANIFEST_SHA,
        expectedProbeIds: probeIds,
      });
    }
    assert.equal(correlationBacklogBlocksLaunch(root), true);
  });

  it('queue drain below limit permits the next batch', () => {
    for (let i = 1; i <= 5; i += 1) finalizeBatch(root, 100 + i);
    serviceCorrelationQueueBeforeBatch(root, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA });
    assert.equal(correlationBacklogBlocksLaunch(root), false);
  });

  it('restart does not duplicate queue entries', () => {
    finalizeBatch(root, 12);
    serviceCorrelationQueueBeforeBatch(root, { runId: RUN_ID, launchHead: LAUNCH_HEAD, manifestSha: MANIFEST_SHA });
    assert.equal(readCorrelationQueue(root).jobs.length, 1);
  });

  it('restart does not duplicate packet indexes', () => {
    const batchId = 'batch-no-dup-index';
    const probeIds = { h1: 71, h2: 72, h3: 73 };
    writeIndexes(root, batchId, probeIds);
    finalizeTripletCorrelationJob(root, {
      batchId,
      runId: RUN_ID,
      launchHead: LAUNCH_HEAD,
      manifestSha: MANIFEST_SHA,
      expectedProbeIds: probeIds,
    });
    assert.equal(fs.readdirSync(path.join(root, 'probe-packet-index')).length, 3);
    drainCorrelationQueue(root);
    assert.equal(fs.readdirSync(path.join(root, 'probe-packet-index')).length, 3);
  });

  it('classifies baseline-r3 legacy fixture read-only', () => {
    const fixture = classifyLegacyBacklogFixture({
      outRoot: '/tmp/phase32h-r1-baseline-r3',
      legacyBacklog: { pending: 51, batches: new Array(51).fill({ batch_id: 'x' }) },
      probeIndexCount: 153,
      batchIndexCount: 51,
    });
    assert.equal(fixture.classification, 'LEGACY_ENQUEUE_WITHOUT_DRAIN');
    assert.equal(fixture.read_only, true);
    assert.equal(fixture.data_lost, false);
  });

  it('recomputeQueueStats tracks pending running complete failed', () => {
    const queue = readCorrelationQueue(root);
    queue.jobs.push({
      job_id: 'j1',
      batch_id: 'b1',
      run_id: RUN_ID,
      launch_head: LAUNCH_HEAD,
      manifest_sha: MANIFEST_SHA,
      status: JOB_STATUS.PENDING,
      enqueued_at: new Date().toISOString(),
      expected_probe_ids: {},
    });
    const stats = recomputeQueueStats(queue);
    assert.equal(stats.pending_count, 1);
    assert.equal(stats.unresolved_count, 1);
  });
});
