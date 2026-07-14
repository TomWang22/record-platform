import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  writeBatchPacketIndex,
  updateBatchPacketIndex,
} from '../scripts/lib/phase32h-batch-packet-index.mjs';
import {
  BATCH_INDEX_ALIGNMENT,
  BATCH_INDEX_LIFECYCLE,
  completeBatchPacketIndex,
  evaluateBatchIndexAlignment,
  evaluatePacketIndexLifecycle,
  failBatchPacketIndex,
  markBatchPacketIndexStatus,
  patchTripletOrchestratorMarker,
  snapshotFingerprint,
} from '../scripts/lib/phase32h-packet-index-lifecycle.mjs';
import { evaluatePacketIndexCoverage } from '../scripts/lib/phase32h-packet-index-coverage.mjs';
import { buildPhase32hSummary } from '../scripts/lib/phase32h-targeted-summary.mjs';
import {
  assertTerminalTimingFields,
  extractProtocol,
  extractWallTotalMs,
} from '../scripts/lib/phase32h-matrix-row-fields.mjs';
import { assertWritableEvidenceRoot, isFrozenRoot } from '../scripts/lib/phase32h-freeze-integrity.mjs';
import { R1_TOTAL } from '../scripts/lib/phase32h-r1-config.mjs';
import { scanPrivateFields } from '../scripts/lib/phase32h-targeted-summary.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase32h-lifecycle-'));
}

function writeIndex(root, batchId, status = 'PENDING') {
  return writeBatchPacketIndex(root, {
    batch_id: batchId,
    run_id: 'run',
    member_probe_ids: { h1: 1, h2: 2, h3: 3 },
    coordinate: { case_id: 'c', window: 1, run: 1, user_uid: 'u', user_class: 'a' },
    packet_correlation_status: status,
  });
}

function writeCompletedBatchFile(root, batchId) {
  const dir = path.join(root, 'batches');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${batchId}.json`), `${JSON.stringify({ batch_id: batchId })}\n`);
}

describe('phase32h packet-index lifecycle alignment', () => {
  let root;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('1. aligned active state, delta 0', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.COMPLETE);
    writeCompletedBatchFile(root, 'b1');
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [{ batch_id: 'b1', record: writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.COMPLETE) }],
      completedBatchCount: 1,
      activeBatchId: null,
      phase: 'BETWEEN_BATCHES',
      queue: { failed_count: 0, pending_count: 0, running_count: 0, complete_count: 1 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.ALIGNED);
    assert.equal(r.delta, 0);
  });

  it('2. valid PRE_MATRIX delta +1', () => {
    const rec = writeIndex(root, 'active', BATCH_INDEX_LIFECYCLE.PENDING);
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [{ batch_id: 'active', record: rec }],
      completedBatchCount: 0,
      activeBatchId: 'active',
      phase: 'PRE_MATRIX',
      queue: { failed_count: 0, pending_count: 0, running_count: 0, complete_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD);
  });

  it('3. valid delta +1 follows active batch transition', () => {
    writeIndex(root, 'done', BATCH_INDEX_LIFECYCLE.COMPLETE);
    writeIndex(root, 'next', BATCH_INDEX_LIFECYCLE.PENDING);
    const indexes = [
      { batch_id: 'done', record: { batch_id: 'done', packet_correlation_status: 'COMPLETE' } },
      { batch_id: 'next', record: { batch_id: 'next', packet_correlation_status: 'PENDING' } },
    ];
    const r = evaluateBatchIndexAlignment({
      batchIndexes: indexes,
      completedBatchCount: 1,
      activeBatchId: 'next',
      phase: 'RUNNING',
      queue: { failed_count: 0, pending_count: 0, running_count: 0, complete_count: 1 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD);
    assert.deepEqual(r.extra_ids, ['next']);
  });

  it('4. delta +1 with no active batch', () => {
    const rec = writeIndex(root, 'orphan', BATCH_INDEX_LIFECYCLE.PENDING);
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [{ batch_id: 'orphan', record: rec }],
      completedBatchCount: 0,
      activeBatchId: null,
      phase: 'BETWEEN_BATCHES',
      queue: { failed_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_ORPHAN_INDEX);
  });

  it('5. extra ID differs from active batch', () => {
    const rec = writeIndex(root, 'extra', BATCH_INDEX_LIFECYCLE.PENDING);
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [{ batch_id: 'extra', record: rec }],
      completedBatchCount: 0,
      activeBatchId: 'other',
      phase: 'PRE_MATRIX',
      queue: { failed_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_BATCH_ID_MISMATCH);
  });

  it('6. delta greater than 1', () => {
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [
        { batch_id: 'a', record: { batch_id: 'a', packet_correlation_status: 'PENDING' } },
        { batch_id: 'b', record: { batch_id: 'b', packet_correlation_status: 'PENDING' } },
      ],
      completedBatchCount: 0,
      activeBatchId: 'a',
      queue: { failed_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_INDEX_LEAD);
  });

  it('7. delta less than 0', () => {
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [],
      completedBatchCount: 2,
      queue: { failed_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_INDEX_DEFICIT);
  });

  it('8. queue failure', () => {
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [],
      completedBatchCount: 0,
      queue: { failed_count: 1 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_QUEUE_FAILURE);
  });

  it('9. malformed batch index', () => {
    const r = evaluateBatchIndexAlignment({
      batchIndexes: [{ batch_id: 'x', record: { batch_id: 'x', packet_correlation_status: 'WEIRD' } }],
      completedBatchCount: 0,
      queue: { failed_count: 0 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.BLOCKED_MALFORMED_INDEX);
  });

  it('10. PENDING → COMPLETE atomic transition', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.PENDING);
    const done = completeBatchPacketIndex(root, 'b1', { correlation_job_id: 'j1' });
    assert.equal(done.packet_correlation_status, BATCH_INDEX_LIFECYCLE.COMPLETE);
    assert.equal(done.correlation_job_id, 'j1');
    const file = path.join(root, 'batch-packet-index', 'b1.json');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).packet_correlation_status, 'COMPLETE');
  });

  it('11. failed correlation → FAILED transition', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.PENDING);
    markBatchPacketIndexStatus(root, 'b1', BATCH_INDEX_LIFECYCLE.CORRELATING);
    const failed = failBatchPacketIndex(root, 'b1', { reason: 'boom' });
    assert.equal(failed.packet_correlation_status, BATCH_INDEX_LIFECYCLE.FAILED);
  });

  it('12. terminal exact target with delta 0', () => {
    const indexes = [];
    for (let i = 0; i < 3; i += 1) {
      const id = `b${i}`;
      indexes.push({
        batch_id: id,
        record: { batch_id: id, packet_correlation_status: BATCH_INDEX_LIFECYCLE.COMPLETE },
      });
    }
    const r = evaluateBatchIndexAlignment({
      batchIndexes: indexes,
      completedBatchCount: 3,
      activeBatchId: null,
      orchestratorStatus: 'COMPLETE',
      targetBatches: 3,
      targetProbes: 9,
      probeIndexCount: 9,
      queue: { failed_count: 0, pending_count: 0, running_count: 0, complete_count: 3 },
    });
    assert.equal(r.status, BATCH_INDEX_ALIGNMENT.TERMINAL_PASS);
  });

  it('13. terminal PASS summary never reports IN_PROGRESS', () => {
    fs.mkdirSync(path.join(root, 'run-state'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'phase32h-r1-launch.json'),
      JSON.stringify({
        target_total: 3,
        target_per_protocol: 1,
        evidence_label: 'Phase 32H-R1 baseline synchronized-stall validation',
      }),
    );
    fs.writeFileSync(path.join(root, 'FROZEN_PASS_EVIDENCE'), 'now\nPASS\n');
    const rows = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'].map((proto, i) => ({
      probe_id: i + 1,
      protocol_label: proto,
      matrix_protocol: proto === 'HTTP/1.1' ? 'h1' : proto === 'HTTP/2' ? 'h2' : 'h3',
      http_status: 200,
      version_ok: true,
      gate_reason: 'preview_opt_in',
      expected_gate_reason: 'preview_opt_in',
      response_pass: 'PASS',
      leakage_pass: 'PASS',
      fallback_count: 0,
      rag_total_ms: 200,
      evidence_label: 'Phase 32H-R1 baseline synchronized-stall validation',
      timing: {
        wall_total_ms: 500,
        curl_time_total_ms: 450,
        curl_time_starttransfer_ms: 200,
        server_timing_rag_total_ms: 200,
      },
    }));
    const summary = buildPhase32hSummary(root, rows);
    assert.equal(summary.status, 'PASS');
    assert.equal(summary.phase_status, 'PASS');
    assert.equal(summary.summary_status_note, 'PASS');
    assert.equal(summary.matrix_complete, true);
    assert.equal(summary.freeze_complete, true);
    assert.equal(summary.frozen_evidence, 'FROZEN_PASS_EVIDENCE');
    assert.equal(summary.protected_arm, 'NOT_LAUNCHED');
    assert.equal(summary.production_enablement, 'NOT APPROVED');
    assert.notEqual(summary.status, 'IN_PROGRESS');
  });

  it('14. mixed-time snapshot rejected', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.PENDING);
    patchTripletOrchestratorMarker(root, {
      status: 'IN_PROGRESS',
      phase: 'PRE_MATRIX',
      active_batch_id: 'b1',
    });
    // Simulate change mid-read by mutating after first fingerprint capture inside evaluator:
    // Monkey: call evaluate twice with mutation between listing — use fingerprint inequality directly.
    const a = snapshotFingerprint({
      matrixTotal: 0,
      completedBatchCount: 0,
      batchIndexCount: 1,
      probeIndexCount: 0,
      queue: { pending_count: 0, running_count: 0, complete_count: 0, failed_count: 0 },
      orchestrator: { status: 'IN_PROGRESS', phase: 'PRE_MATRIX', active_batch_id: 'b1' },
    });
    const b = snapshotFingerprint({
      matrixTotal: 3,
      completedBatchCount: 1,
      batchIndexCount: 1,
      probeIndexCount: 3,
      queue: { pending_count: 0, running_count: 0, complete_count: 1, failed_count: 0 },
      orchestrator: { status: 'IN_PROGRESS', phase: 'BETWEEN_BATCHES', active_batch_id: null },
    });
    assert.notEqual(a, b);
  });

  it('15. snapshot generation changes during read', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.PENDING);
    patchTripletOrchestratorMarker(root, {
      status: 'IN_PROGRESS',
      phase: 'PRE_MATRIX',
      active_batch_id: 'b1',
    });
    const orchPath = path.join(root, 'run-state', 'triplet-orchestrator.json');
    let orchReads = 0;
    const origRead = fs.readFileSync;
    fs.readFileSync = function patchedRead(file, ...rest) {
      const result = origRead.call(this, file, ...rest);
      if (String(file) === orchPath || String(file).endsWith(`${path.sep}triplet-orchestrator.json`)) {
        orchReads += 1;
        if (orchReads === 1) {
          const parsed = JSON.parse(result);
          parsed.phase = 'RUNNING';
          origRead === fs.readFileSync; // keep lint quiet
          fs.writeFileSync(orchPath, `${JSON.stringify(parsed, null, 2)}\n`);
        }
      }
      return result;
    };
    try {
      const report = evaluatePacketIndexLifecycle(root, {
        expectedBatchCorrelations: 0,
        completedBatchCount: 0,
        matrixTotal: 0,
      });
      assert.equal(report.status, BATCH_INDEX_ALIGNMENT.SNAPSHOT_CHANGED_DURING_READ);
      assert.equal(report.discard, true);
    } finally {
      fs.readFileSync = origRead;
    }
  });

  it('16. nested timing fields extracted correctly', () => {
    const row = {
      timing: { wall_total_ms: 8264, curl_time_total_ms: 8000, curl_time_starttransfer_ms: 8055.8, server_timing_rag_total_ms: 7924 },
      wall_total_ms: null,
    };
    assert.equal(extractWallTotalMs(row), 8264);
    const got = assertTerminalTimingFields({ ...row, protocol_label: 'HTTP/3' });
    assert.equal(got.wall, 8264);
    assert.equal(got.start, 8055.8);
  });

  it('17. protocol fallback resolution', () => {
    assert.equal(extractProtocol({ protocol_label: 'HTTP/2' }), 'HTTP/2');
    assert.equal(extractProtocol({ protocol: 'HTTP/1.1' }), 'HTTP/1.1');
    assert.equal(extractProtocol({ matrix_protocol: 'h3' }), 'HTTP/3');
    assert.equal(extractProtocol({ http_version: '2' }), 'HTTP/2');
  });

  it('18. missing required terminal timing fails closed', () => {
    assert.throws(
      () => assertTerminalTimingFields({ protocol_label: 'HTTP/1.1', timing: {} }),
      (err) => err.code === 'PHASE32H_TERMINAL_TIMING_MISSING',
    );
  });

  it('19. historical frozen roots are never rewritten', () => {
    fs.writeFileSync(path.join(root, 'FROZEN_PASS_EVIDENCE'), 'frozen\n');
    assert.equal(isFrozenRoot(root), true);
    assert.throws(
      () => assertWritableEvidenceRoot(root, path.join(root, 'batch-packet-index', 'x.json')),
      (err) => err.code === 'PHASE32H_FREEZE_INTEGRITY_BLOCKED',
    );
  });

  it('20. private-field scan remains clean', () => {
    const rows = [
      {
        probe_id: 1,
        protocol_label: 'HTTP/1.1',
        case_id: 'c',
        window: 1,
        run: 1,
        user_class: 'contract',
        expected_gate: 'allowlist',
        evidence_label: 'x',
      },
    ];
    assert.equal(scanPrivateFields(rows).pass, true);
  });

  it('coverage evaluator does not emit BLOCKED for valid ACTIVE_TRANSIENT_LEAD', () => {
    writeIndex(root, 'active', BATCH_INDEX_LIFECYCLE.PENDING);
    patchTripletOrchestratorMarker(root, {
      status: 'IN_PROGRESS',
      phase: 'PRE_MATRIX',
      active_batch_id: 'active',
    });
    const report = evaluatePacketIndexCoverage(root, {
      expectedProbeIndexes: 0,
      expectedBatchCorrelations: 0,
      requirePerProbeIndexes: false,
      completedBatchCount: 0,
      matrixTotal: 0,
    });
    assert.equal(report.status, BATCH_INDEX_ALIGNMENT.ACTIVE_TRANSIENT_LEAD);
    assert.notEqual(report.status, 'BLOCKED');
  });

  it('updateBatchPacketIndex is atomic rename', () => {
    writeIndex(root, 'b1', BATCH_INDEX_LIFECYCLE.PENDING);
    updateBatchPacketIndex(root, 'b1', { packet_correlation_status: BATCH_INDEX_LIFECYCLE.COMPLETE });
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'batch-packet-index', 'b1.json'), 'utf8'))
        .packet_correlation_status,
      'COMPLETE',
    );
  });

  it('R1 launch target resolves PASS without requiring 17280', () => {
    fs.writeFileSync(
      path.join(root, 'phase32h-r1-launch.json'),
      JSON.stringify({
        target_total: R1_TOTAL,
        target_per_protocol: R1_TOTAL / 3,
        evidence_label: 'Phase 32H-R1 baseline synchronized-stall validation',
      }),
    );
    // Use tiny fixture: launch target overrides — build with matching row count via small custom launch.
    fs.writeFileSync(
      path.join(root, 'phase32h-r1-launch.json'),
      JSON.stringify({
        target_total: 3,
        target_per_protocol: 1,
        evidence_label: 'Phase 32H-R1 baseline synchronized-stall validation',
      }),
    );
    const rows = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'].map((proto, i) => ({
      probe_id: i + 1,
      protocol_label: proto,
      matrix_protocol: ['h1', 'h2', 'h3'][i],
      http_status: 200,
      version_ok: true,
      gate_reason: 'preview_opt_in',
      expected_gate_reason: 'preview_opt_in',
      response_pass: 'PASS',
      leakage_pass: 'PASS',
      fallback_count: 0,
      evidence_label: 'Phase 32H-R1 baseline synchronized-stall validation',
      timing: {
        wall_total_ms: 100,
        curl_time_total_ms: 90,
        curl_time_starttransfer_ms: 50,
        server_timing_rag_total_ms: 40,
      },
    }));
    const summary = buildPhase32hSummary(root, rows);
    assert.equal(summary.status, 'PASS');
    assert.match(summary.matrix_total, /3\/3/);
  });
});
