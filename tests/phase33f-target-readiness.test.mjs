/**
 * Phase 33F target-readiness: workload hash + resource telemetry + freeze regressions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCanaryManifest } from '../scripts/lib/phase33f-canary-manifest.mjs';
import {
  hashCanonicalWorkload,
  computeManifestShaFromRows,
  legacyProbeIdWorkloadHash,
  classifyWorkloadHashReport,
  WORKLOAD_HASH_SERIALIZATION_VERSION,
  normalizeWorkloadCoordinate,
} from '../scripts/lib/phase33f-workload-hash.mjs';
import {
  sampleRunnerResourceTelemetry,
  appendRunnerResourceTelemetry,
  readRunnerResourceTelemetryTail,
  evaluateResourcePolicy,
  RESOURCE_HARD_LIMITS,
} from '../scripts/lib/phase33f-runner-resource-telemetry.mjs';
import { finalizePhase33fRun } from '../scripts/lib/phase33f-run-finalize.mjs';
import { REAL_TARGET_ROOT } from '../scripts/lib/phase33f-canary-config.mjs';
import { CORRELATION_QUEUE_SCHEMA_VERSION } from '../scripts/lib/phase32h-correlation-queue.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('phase33f workload hash', () => {
  it('manifest SHA differs from canonical workload hash', () => {
    const rows = buildCanaryManifest({ batchesPerCapability: 30 });
    const manifestSha = computeManifestShaFromRows(rows);
    const workload = hashCanonicalWorkload(rows);
    assert.equal(workload.serialization_version, WORKLOAD_HASH_SERIALIZATION_VERSION);
    assert.equal(workload.coordinate_count, 720);
    assert.equal(workload.duplicate_coordinate_keys, 0);
    assert.notEqual(manifestSha, workload.canonical_workload_hash);
  });

  it('legacy probe-id hash matches historical 0e20147d value', () => {
    const rows = buildCanaryManifest({ batchesPerCapability: 30 });
    assert.equal(
      legacyProbeIdWorkloadHash(rows),
      '0e20147dbc4d0fa7da8ef6bdaefe06d47c5920dc3b794578e1aacfc3e4c39c8d',
    );
  });

  it('classifies manifest-as-workload report as CANONICAL_WORKLOAD_HASH_REPORTING_DEFECT', () => {
    const rows = buildCanaryManifest({ batchesPerCapability: 30 });
    const manifestSha = computeManifestShaFromRows(rows);
    const workload = hashCanonicalWorkload(rows);
    const cls = classifyWorkloadHashReport({
      reportedWorkloadHash: manifestSha,
      manifestSha,
      recomputedWorkloadHash: workload.canonical_workload_hash,
      previousWorkloadHash: legacyProbeIdWorkloadHash(rows),
      legacyHash: legacyProbeIdWorkloadHash(rows),
    });
    assert.equal(cls.classification, 'CANONICAL_WORKLOAD_HASH_REPORTING_DEFECT');
  });

  it('excludes volatile fields from coordinates', () => {
    const rows = buildCanaryManifest({ batchesPerCapability: 1 });
    const c = normalizeWorkloadCoordinate(rows[0]);
    assert.equal('probe_id' in c, false);
    assert.equal('batch_id' in c, false);
    assert.equal('run' in c, false);
    assert.ok(c.scenario_id);
    assert.ok(c.prompt_input_fixture_hash);
  });

  it('target 17280 has unique coordinates and stable hash', () => {
    const rows = buildCanaryManifest({ batchesPerCapability: 720 });
    assert.equal(rows.length, 17280);
    const a = hashCanonicalWorkload(rows);
    const b = hashCanonicalWorkload(rows);
    assert.equal(a.canonical_workload_hash, b.canonical_workload_hash);
    assert.equal(a.duplicate_coordinate_keys, 0);
  });
});

describe('phase33f runner resource telemetry', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33f-res-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('appends redacted samples and status tail stays bounded', async () => {
    for (let i = 0; i < 40; i += 1) {
      const sample = sampleRunnerResourceTelemetry({
        completedBatch: i,
        probeTotal: i * 3,
        workerPool: { size: 3, busyCount: 1, queueDepth: 0 },
      });
      assert.equal('prompt' in sample, false);
      assert.equal('token' in sample, false);
      appendRunnerResourceTelemetry(root, sample);
    }
    const tail = await readRunnerResourceTelemetryTail(root, { limit: 8 });
    assert.equal(tail.status, 'OK');
    assert.equal(tail.rows.length, 8);
    assert.ok(tail.lines_seen >= 40);
  });

  it('telemetry write failure surfaces code', () => {
    assert.throws(
      () => appendRunnerResourceTelemetry(null, sampleRunnerResourceTelemetry({})),
      (err) => err.code === 'RUNNER_TELEMETRY_WRITE_FAIL',
    );
  });

  it('malformed telemetry is reported without throwing', async () => {
    const file = path.join(root, 'telemetry', 'runner-resource-telemetry.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not-json\n{"broken":true}\n', 'utf8');
    const tail = await readRunnerResourceTelemetryTail(root, { limit: 8 });
    assert.ok(tail.status === 'MALFORMED' || tail.malformed > 0);
  });

  it('worker-count overflow violates policy', () => {
    const samples = [
      sampleRunnerResourceTelemetry({
        completedBatch: 0,
        workerPool: { size: 3, busyCount: 0, queueDepth: 0 },
      }),
      {
        ...sampleRunnerResourceTelemetry({
          completedBatch: 25,
          workerPool: { size: 3, busyCount: 9, queueDepth: 0 },
        }),
        worker_active: 9,
      },
    ];
    const ev = evaluateResourcePolicy(samples);
    assert.equal(ev.status, 'FAIL');
    assert.ok(ev.violations.some((v) => v.startsWith('worker_active_overflow')));
  });

  it('listener growth beyond policy blocks', () => {
    const samples = [];
    for (let i = 0; i <= 40; i += 1) {
      samples.push({
        ...sampleRunnerResourceTelemetry({ completedBatch: i }),
        listener_current: i * 2,
        completed_batch: i,
        heap_used_mb: 50,
        rss_mb: 100,
      });
    }
    const ev = evaluateResourcePolicy(samples);
    assert.equal(ev.status, 'FAIL');
    assert.ok(ev.violations.some((v) => v.startsWith('listener_linear_growth')));
  });

  it('MessagePort final leak blocks', () => {
    const samples = [
      { ...sampleRunnerResourceTelemetry({ completedBatch: 0 }), message_port_current: 0 },
      { ...sampleRunnerResourceTelemetry({ completedBatch: 30 }), message_port_current: 0 },
    ];
    const ev = evaluateResourcePolicy(samples, {
      messagePortFinal: 3,
      baseline: { listeners: 0, active_handles: 0, message_ports: 0 },
    });
    assert.equal(ev.status, 'FAIL');
    assert.ok(ev.violations.some((v) => v.startsWith('message_port_final')));
  });

  it('active-handle leak above baseline blocks', () => {
    const samples = [
      { ...sampleRunnerResourceTelemetry({ completedBatch: 0 }), active_handle_current: 10 },
      { ...sampleRunnerResourceTelemetry({ completedBatch: 30 }), active_handle_current: 10 },
    ];
    const ev = evaluateResourcePolicy(samples, {
      activeHandleFinal: 40,
      baseline: { listeners: 2, active_handles: 10 },
    });
    assert.equal(ev.status, 'FAIL');
    assert.ok(ev.violations.some((v) => v.startsWith('active_handle_final_delta')));
  });
});

describe('phase33f target launch guards', () => {
  it('target root remains absent', () => {
    assert.equal(fs.existsSync(REAL_TARGET_ROOT), false);
  });

  it('PASS and BLOCKED markers are mutually exclusive; marker written last', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase33f-target-guard-'));
    try {
      fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'run-state', 'correlation-queue.json'),
        `${JSON.stringify({
          schema_version: CORRELATION_QUEUE_SCHEMA_VERSION,
          jobs: [],
          stats: {
            pending_count: 0,
            running_count: 0,
            complete_count: 1,
            failed_count: 0,
            unresolved_count: 0,
          },
        })}\n`,
      );
      fs.writeFileSync(path.join(root, 'run-state', 'run-id'), 't\n');
      const blocked = finalizePhase33fRun({
        outRoot: root,
        repoRoot: REPO_ROOT,
        status: 'BLOCKED',
        failureClass: 'EDGE_RATE_LIMITED',
        quietPeriodMs: 20,
        gracefulMs: 200,
      });
      assert.equal(blocked.freeze.freeze?.marker_written_last, true);
      assert.ok(fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE')));
      assert.ok(!fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resource hard limits are defined for target', () => {
    assert.equal(RESOURCE_HARD_LIMITS.worker_active_max, 3);
    assert.equal(RESOURCE_HARD_LIMITS.worker_final_max, 0);
    assert.equal(RESOURCE_HARD_LIMITS.message_port_final_max, 0);
  });
});
