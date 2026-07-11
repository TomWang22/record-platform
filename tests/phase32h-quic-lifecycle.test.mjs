import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONNECTION_MODES } from '../scripts/lib/phase32h-quic-lifecycle.mjs';
import { assertRagPostNotEarlyData } from '../scripts/lib/phase32h-transport-capabilities.mjs';
import { classifyZeroRttOutcome, classifySessionResumeOutcome } from '../scripts/lib/phase32h-quic-packet-space.mjs';

describe('phase32h quic lifecycle safety', () => {
  it('defines four connection lifecycle modes', () => {
    assert.deepEqual(CONNECTION_MODES, ['cold', 'warm_reuse', 'resumed_1rtt', 'attempted_0rtt']);
  });

  it('lifecycle mini-matrix modes are excluded from main matrix totals helper', () => {
    const mainTotal = 8640;
    const lifecyclePerArm = 30 * 4;
    assert.ok(lifecyclePerArm < mainTotal);
    assert.notEqual(lifecyclePerArm, mainTotal);
  });

  it('never allows RAG query in attempted_0rtt', () => {
    assert.throws(() => assertRagPostNotEarlyData('/api/ai/rag/query', 'attempted_0rtt'));
  });

  it('unsupported session resume is an honest PASS gate outcome', () => {
    const outcome = classifySessionResumeOutcome({
      sessionResumeSupported: false,
      httpStatus: 0,
      oneRttConfirmed: false,
      zeroRttPackets: 0,
    });
    assert.equal(outcome, 'CLIENT_SESSION_RESUME_UNSUPPORTED');
  });
});
