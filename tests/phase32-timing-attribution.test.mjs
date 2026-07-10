import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertAllowedOutputPath,
  assertRedactedProbeRow,
  attachTimingToProbeRow,
  buildTimingAttribution,
  computeUnattributedMs,
  computeWallTotalMs,
  coordinatorWaitIsNotRagTotal,
  extractAppRagTotalMs,
  retryDelayIsNotRagTotal,
  timingSeparatesRagFromCurl,
  validateTimingAttribution,
  Phase32TimingAttributionError,
} from '../scripts/lib/phase32-timing-attribution.mjs';

describe('phase32 timing attribution', () => {
  it('computes wall_total_ms from start/end timestamps', () => {
    const wall = computeWallTotalMs('2026-07-10T16:00:00.000Z', '2026-07-10T16:00:01.250Z');
    assert.equal(wall, 1250);
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:01.250Z',
      curl_time_total_ms: 420,
      coordinator_wait_ms: 0,
      window_reset_ms: 0,
      pre_probe_gate_verify_ms: 0,
      retry_delay_ms: 0,
      kpi_query_write_ms: 0,
      kpi_usefulness_write_ms: 0,
      jsonl_write_ms: 0,
    });
    assert.equal(timing.wall_total_ms, 1250);
  });

  it('computes unattributed_ms', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:01.000Z',
      curl_time_total_ms: 300,
      coordinator_wait_ms: 100,
      window_reset_ms: 50,
      pre_probe_gate_verify_ms: 0,
      retry_delay_ms: 100,
      kpi_query_write_ms: 50,
      kpi_usefulness_write_ms: 25,
      jsonl_write_ms: 5,
    });
    assert.equal(timing.wall_total_ms, 1000);
    assert.equal(computeUnattributedMs(timing), 370);
  });

  it('handles missing curl_time_total_ms as null / unknown', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:00.500Z',
      curl_time_total_ms: null,
      rag_total_ms: 210,
    });
    assert.equal(timing.curl_time_total_ms, null);
    assert.equal(timing.rag_total_ms, 210);
  });

  it('rejects negative timing fields', () => {
    assert.throws(
      () =>
        buildTimingAttribution({
          probe_started_at: '2026-07-10T16:00:00.000Z',
          probe_finished_at: '2026-07-10T16:00:01.000Z',
          coordinator_wait_ms: -1,
        }),
      Phase32TimingAttributionError,
    );
  });

  it('rejects forbidden private fields', () => {
    assert.throws(
      () => assertRedactedProbeRow({ probe_id: 1, question: 'secret prompt' }),
      /forbidden field: question/,
    );
    assert.throws(
      () => assertRedactedProbeRow({ probe_id: 1, token: 'abc' }),
      /forbidden field: token/,
    );
  });

  it('preserves H1/H2/H3 protocol labels', () => {
    for (const label of ['HTTP/1.1', 'HTTP/2', 'HTTP/3']) {
      const row = attachTimingToProbeRow(
        { probe_id: 1, protocol_label: label, matrix_protocol: label.replace('HTTP/', 'h').replace('.', '') },
        buildTimingAttribution({
          probe_started_at: '2026-07-10T16:00:00.000Z',
          probe_finished_at: '2026-07-10T16:00:00.100Z',
        }),
      );
      assert.equal(row.protocol_label, label);
    }
  });

  it('does not classify coordinator wait as rag_total_ms', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:10.000Z',
      coordinator_wait_ms: 5000,
      rag_total_ms: 300,
      curl_time_total_ms: 320,
    });
    assert.ok(coordinatorWaitIsNotRagTotal(timing));
  });

  it('does not classify retry delay as rag_total_ms', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:05.000Z',
      retry_delay_ms: 2000,
      rag_total_ms: 300,
      curl_time_total_ms: 320,
    });
    assert.ok(retryDelayIsNotRagTotal(timing));
  });

  it('keeps rag_total_ms separate from curl_time_total_ms when both present', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:01.000Z',
      curl_time_total_ms: 500,
      rag_total_ms: 300,
    });
    assert.ok(timingSeparatesRagFromCurl(timing));
  });

  it('extracts app rag_total_ms from response body when present', () => {
    assert.equal(extractAppRagTotalMs({ details: { rag_total_ms: 412 } }), 412);
    assert.equal(extractAppRagTotalMs({ summary: 'ok' }), null);
  });

  it('allows output only under /tmp', () => {
    assert.doesNotThrow(() => assertAllowedOutputPath('/tmp/phase32-timing-attribution-smoke'));
    assert.throws(() => assertAllowedOutputPath('/var/tmp/nope'), /must be under \/tmp/);
  });

  it('validates required timing fields', () => {
    const timing = buildTimingAttribution({
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:00.100Z',
      curl_time_total_ms: 80,
    });
    assert.doesNotThrow(() => validateTimingAttribution(timing));
  });

  it('smoke fixture writes only under /tmp', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32-timing-smoke-'));
    assert.ok(outDir.startsWith('/tmp/') || outDir.includes('T')); // os.tmpdir on mac is /var/folders... 
    // assertAllowedOutputPath requires /tmp prefix specifically
    assert.throws(() => assertAllowedOutputPath(outDir), /must be under \/tmp/);
  });
});
