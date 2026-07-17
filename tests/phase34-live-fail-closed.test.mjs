import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyHardProtocolFailure,
  evaluateLiveTripletFailClosed,
  PHASE34_PROTOCOL_ACCEPTANCE_FAILURE,
} from '../scripts/lib/phase34-live-fail-closed.mjs';
import {
  computeSessionsPerMinute,
  classifyRuntimeAcceptance,
  streamMatrixCounters,
} from '../scripts/lib/phase34-runtime-status-bounded.mjs';
import { resolveEvidenceRootFromCommand } from '../scripts/lib/phase32h-process-identity.mjs';

test('H2 502 blocks next batch (fail-closed)', () => {
  const gate = evaluateLiveTripletFailClosed({
    h1: { protocol: 'h1', ok: true, http_status: 200 },
    h2: { protocol: 'h2', ok: false, http_status: 502 },
    h3: { protocol: 'h3', ok: true, http_status: 200 },
  });
  assert.equal(gate.stop, true);
  assert.equal(gate.code, PHASE34_PROTOCOL_ACCEPTANCE_FAILURE);
  assert.equal(gate.protocol_failure_count, 1);
  assert.equal(gate.logical_failure_count, 1);
});

test('H3 502 blocks next batch (fail-closed)', () => {
  const gate = evaluateLiveTripletFailClosed({
    h1: { protocol: 'h1', ok: true, http_status: 200 },
    h2: { protocol: 'h2', ok: true, http_status: 200 },
    h3: { protocol: 'h3', ok: false, http_status: 502 },
  });
  assert.equal(gate.stop, true);
  assert.equal(classifyHardProtocolFailure({ http_status: 502, ok: false }), 'HTTP_5XX');
});

test('two failures in one triplet = one logical failure and two protocol failures', () => {
  const gate = evaluateLiveTripletFailClosed({
    h1: { protocol: 'h1', ok: true, http_status: 200 },
    h2: { protocol: 'h2', ok: false, http_status: 502 },
    h3: { protocol: 'h3', ok: false, http_status: 502 },
  });
  assert.equal(gate.protocol_failure_count, 2);
  assert.equal(gate.logical_failure_count, 1);
  assert.equal(gate.stop, true);
});

test('queue COMPLETE does not permit continuation when protocol failed', () => {
  const gate = evaluateLiveTripletFailClosed({
    h1: { protocol: 'h1', ok: false, http_status: 502 },
    h2: { protocol: 'h2', ok: true, http_status: 200 },
    h3: { protocol: 'h3', ok: true, http_status: 200 },
  });
  assert.equal(gate.stop, true);
});

test('HTTP 0 / curl / 422 / 429 are hard stops', () => {
  assert.equal(classifyHardProtocolFailure({ http_status: 0, ok: false }), 'HTTP_0');
  assert.equal(classifyHardProtocolFailure({ http_status: 0, error_class: 'curl_failed', ok: false }), 'CURL_FAILURE');
  assert.equal(classifyHardProtocolFailure({ http_status: 422, ok: false }), 'HTTP_422');
  assert.equal(classifyHardProtocolFailure({ http_status: 429, ok: false }), 'HTTP_429');
});

test('60-second interval with 40 completions → 40 sessions/minute', () => {
  const r = computeSessionsPerMinute({
    previousComplete: 100,
    currentComplete: 140,
    previousAtMs: 1_000_000,
    currentAtMs: 1_000_000 + 60_000,
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.sessions_per_minute, 40);
});

test('zero-duration / reversed timestamps / counter reset rejected', () => {
  assert.equal(
    computeSessionsPerMinute({
      previousComplete: 10,
      currentComplete: 11,
      previousAtMs: 100,
      currentAtMs: 100,
    }).reason,
    'non_positive_or_reversed_interval',
  );
  assert.equal(
    computeSessionsPerMinute({
      previousComplete: 10,
      currentComplete: 11,
      previousAtMs: 200,
      currentAtMs: 100,
    }).reason,
    'non_positive_or_reversed_interval',
  );
  assert.equal(
    computeSessionsPerMinute({
      previousComplete: 50,
      currentComplete: 40,
      previousAtMs: 0,
      currentAtMs: 60_000,
    }).reason,
    'counter_reset',
  );
});

test('impossible rates rejected', () => {
  const r = computeSessionsPerMinute({
    previousComplete: 0,
    currentComplete: 1_000_000,
    previousAtMs: 0,
    currentAtMs: 1000,
  });
  assert.equal(r.status, 'REJECTED');
  assert.equal(r.reason, 'impossible_rate');
});

test('acceptance BLOCKED while execution ADVANCING requires cooperative termination', () => {
  const c = classifyRuntimeAcceptance({
    protocolFail: 2,
    logicalFail: 1,
    runnerAlive: true,
    queueCompleteIncreasing: true,
  });
  assert.equal(c.execution_state, 'ADVANCING');
  assert.equal(c.acceptance_state, 'BLOCKED');
  assert.equal(c.cooperative_termination_required, true);
});

test('phase34 evidence roots resolve for dumpcap -w paths', () => {
  const root = resolveEvidenceRootFromCommand(
    '/opt/homebrew/bin/dumpcap -q -i bridge100 -w /tmp/phase34-live-inference-gauntlet-v2/pcap/x.pcapng',
  );
  assert.equal(root, '/tmp/phase34-live-inference-gauntlet-v2');
});

test('streamMatrixCounters stays bounded and does not full-split into memory arrays of rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-matrix-stream-'));
  try {
    for (const shard of ['h1', 'h2', 'h3']) {
      const shardDir = path.join(dir, `shard-${shard}`);
      fs.mkdirSync(shardDir, { recursive: true });
      const lines = [];
      for (let i = 0; i < 100; i += 1) {
        const ok = !(i === 5 && shard !== 'h1');
        lines.push(
          JSON.stringify({
            batch_id: `batch_${String(i).padStart(4, '0')}_scarcity`,
            protocol: shard,
            capability: 'scarcity',
            ok,
            http_status: ok ? 200 : 502,
          }),
        );
      }
      fs.writeFileSync(path.join(shardDir, 'phase33f-matrix.jsonl'), `${lines.join('\n')}\n`);
    }
    const counts = await streamMatrixCounters(dir);
    assert.equal(counts.total, 300);
    assert.equal(counts.fail, 2);
    assert.equal(counts.logical_complete, 100);
    assert.equal(counts.logical_fail, 1);
    assert.equal(counts.capability_logical.scarcity, 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
