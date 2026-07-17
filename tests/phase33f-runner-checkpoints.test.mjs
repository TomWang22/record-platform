import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatHumanCheckpointLine,
  shouldEmitHumanCheckpoint,
  summarizeRunnerResult,
} from '../scripts/lib/phase33f-capability-launch-core.mjs';

test('human checkpoint emits every 500 sessions or ten minutes', () => {
  assert.equal(
    shouldEmitHumanCheckpoint({
      completed: 499,
      lastCompleted: 0,
      nowMs: 9 * 60 * 1000,
      lastAtMs: 0,
    }),
    false,
  );
  assert.equal(
    shouldEmitHumanCheckpoint({
      completed: 500,
      lastCompleted: 0,
      nowMs: 9 * 60 * 1000,
      lastAtMs: 0,
    }),
    true,
  );
  assert.equal(
    shouldEmitHumanCheckpoint({
      completed: 501,
      lastCompleted: 500,
      nowMs: 10 * 60 * 1000,
      lastAtMs: 0,
    }),
    true,
  );
});

test('human checkpoint line is bounded and contains no response payloads', () => {
  const line = formatHumanCheckpointLine({
    status: 'ADVANCING',
    completed: 1500,
    target: 20000,
    failed: 0,
    startedAtMs: 0,
    nowMs: 30 * 60 * 1000,
    previousCompleted: 1000,
    previousAtMs: 20 * 60 * 1000,
    queue: { pending_count: 0, running_count: 0, complete_count: 1500, failed_count: 0 },
  });
  assert.match(line, /^PHASE34_CHECKPOINT /);
  assert.match(line, /"completed":1500/);
  assert.match(line, /"sessions_per_minute":50/);
  assert.doesNotMatch(line, /prompt|response|jwt|token|message/i);
  assert.ok(line.length < 1200);
});

test('runner summary omits per-batch payloads before finalization serialization', () => {
  const summary = summarizeRunnerResult({
    status: 'PASS',
    batches: 20000,
    probes: 60000,
    ok_count: 60000,
    fail_count: 0,
    stopped_for_rate_limit: false,
    stopped_for_resource: false,
    failure_class: null,
    inter_batch_interval_ms: 1000,
    batch_results: [
      {
        batch_id: 'batch_1',
        results: {
          h1: { body: { response: 'private payload' } },
        },
      },
    ],
    resource_policy: { status: 'PASS' },
    resource_final: { heap_used_mb: 10, rss_mb: 20 },
  });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.batches, 20000);
  assert.equal(summary.probes, 60000);
  assert.equal(summary.batch_results, undefined);
  assert.equal(JSON.stringify(summary).includes('private payload'), false);
});
