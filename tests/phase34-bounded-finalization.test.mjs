/**
 * Phase 34 — bounded finalization + queue vs protocol acceptance.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FINAL_SUMMARY_MAX_BYTES,
  buildBoundedFinalization,
  evaluateProtocolAcceptance,
  streamMatrixFailureIndex,
  writeBoundedFinalizationReports,
} from '../scripts/lib/phase34-bounded-finalization.mjs';

function writeShard(root, shard, rows) {
  const dir = path.join(root, `shard-${shard}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'phase33f-matrix.jsonl'),
    `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    'utf8',
  );
}

function probe(batchId, capability, protocol, { ok = true, httpStatus = 200, errorClass = null } = {}) {
  return {
    probe_id: `${batchId}_${protocol}`,
    batch_id: batchId,
    capability,
    protocol,
    ok,
    http_status: httpStatus,
    error_class: errorClass,
    started_at: '2026-07-17T00:00:00.000Z',
    finished_at: '2026-07-17T00:00:01.000Z',
  };
}

test('one H2 502 makes the logical session fail even if queue is COMPLETE', () => {
  const acceptance = evaluateProtocolAcceptance({
    queue: { complete_count: 1, failed_count: 0, pending_count: 0, running_count: 0 },
    protocolRows: [
      probe('b1', 'valuation', 'h1', { ok: true }),
      probe('b1', 'valuation', 'h2', { ok: false, httpStatus: 502 }),
      probe('b1', 'valuation', 'h3', { ok: true }),
    ],
  });
  assert.equal(acceptance.queue_complete, 1);
  assert.equal(acceptance.logical_sessions_complete, 1);
  assert.equal(acceptance.logical_sessions_pass, 0);
  assert.equal(acceptance.logical_sessions_fail, 1);
  assert.equal(acceptance.protocol_rows_pass, 2);
  assert.equal(acceptance.protocol_rows_fail, 1);
  assert.equal(acceptance.http_502, 1);
  assert.equal(acceptance.status, 'BLOCKED');
  assert.equal(acceptance.failed_batches_misleading, true);
});

test('one H3 HTTP 0 makes the logical session fail', () => {
  const acceptance = evaluateProtocolAcceptance({
    queue: { complete_count: 1, failed_count: 0, pending_count: 0, running_count: 0 },
    protocolRows: [
      probe('b2', 'market_analytics', 'h1', { ok: true }),
      probe('b2', 'market_analytics', 'h2', { ok: true }),
      probe('b2', 'market_analytics', 'h3', { ok: false, httpStatus: 0, errorClass: 'curl_exit' }),
    ],
  });
  assert.equal(acceptance.logical_sessions_fail, 1);
  assert.equal(acceptance.http_0, 1);
  assert.equal(acceptance.curl_failures, 1);
  assert.equal(acceptance.status, 'BLOCKED');
});

test('queue COMPLETE does not overwrite protocol failure', () => {
  const acceptance = evaluateProtocolAcceptance({
    queue: { complete_count: 2, failed_count: 0, pending_count: 0, running_count: 0 },
    protocolRows: [
      probe('ok', 'scarcity', 'h1'),
      probe('ok', 'scarcity', 'h2'),
      probe('ok', 'scarcity', 'h3'),
      probe('bad', 'valuation', 'h1'),
      probe('bad', 'valuation', 'h2', { ok: false, httpStatus: 502 }),
      probe('bad', 'valuation', 'h3'),
    ],
  });
  assert.equal(acceptance.queue_complete, 2);
  assert.equal(acceptance.logical_sessions_pass, 1);
  assert.equal(acceptance.logical_sessions_fail, 1);
  assert.notEqual(acceptance.status, 'PASS');
});

test('failed batches=0 cannot produce PASS when protocol failures exist', () => {
  const acceptance = evaluateProtocolAcceptance({
    queue: { complete_count: 1, failed_count: 0, pending_count: 0, running_count: 0 },
    runner: { fail_count: 0, batches: 1, status: 'PASS' },
    protocolRows: [
      probe('b', 'valuation', 'h1'),
      probe('b', 'valuation', 'h2', { ok: false, httpStatus: 502 }),
      probe('b', 'valuation', 'h3'),
    ],
  });
  assert.equal(acceptance.runner_claimed_pass, true);
  assert.equal(acceptance.status, 'BLOCKED');
  assert.equal(acceptance.pass_impossible_with_protocol_failures, true);
});

test('bounded finalization summary stays under hard size and omits full result arrays', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-final-'));
  try {
    const rows = [];
    for (let i = 0; i < 60; i += 1) {
      const batch = `batch_${String(i + 1).padStart(4, '0')}_scarcity`;
      for (const proto of ['h1', 'h2', 'h3']) {
        rows.push(
          probe(batch, 'scarcity', proto, {
            ok: i !== 10 || proto !== 'h2',
            httpStatus: i === 10 && proto === 'h2' ? 502 : 200,
          }),
        );
      }
    }
    writeShard(tmp, 'h1', rows.filter((r) => r.protocol === 'h1'));
    writeShard(tmp, 'h2', rows.filter((r) => r.protocol === 'h2'));
    writeShard(tmp, 'h3', rows.filter((r) => r.protocol === 'h3'));
    fs.mkdirSync(path.join(tmp, 'run-state'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'run-state', 'correlation-queue.json'),
      `${JSON.stringify({
        complete_total: 60,
        failed_total: 0,
        stats: { pending_count: 0, running_count: 0, complete_count: 60, failed_count: 0 },
      })}\n`,
    );

    const built = buildBoundedFinalization(tmp, {
      expectedLogicalSessions: 60,
      expectedProtocolRows: 180,
    });
    assert.equal(built.acceptance.status, 'BLOCKED');
    assert.ok(!('batch_results' in built.summary));
    assert.ok(!('protocol_rows' in built.summary));
    assert.ok(Buffer.byteLength(JSON.stringify(built.summary), 'utf8') < FINAL_SUMMARY_MAX_BYTES);

    const written = writeBoundedFinalizationReports(tmp, built);
    assert.ok(fs.existsSync(written.summaryPath));
    assert.ok(fs.existsSync(written.failureIndexPath));
    const summaryBytes = fs.statSync(written.summaryPath).size;
    assert.ok(summaryBytes <= FINAL_SUMMARY_MAX_BYTES);
    const failureLines = fs.readFileSync(written.failureIndexPath, 'utf8').trim().split('\n');
    assert.equal(failureLines.length, 1);
    assert.equal(JSON.parse(failureLines[0]).http_status, 502);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('streamMatrixFailureIndex reports line number for malformed JSONL', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-malformed-'));
  try {
    const dir = path.join(tmp, 'shard-h1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'phase33f-matrix.jsonl'), '{"ok":true}\n{not-json\n{"ok":false}\n');
    assert.throws(
      () => streamMatrixFailureIndex(tmp, { shards: ['h1'] }),
      /malformed detail row.*shard-h1.*line 2/i,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
