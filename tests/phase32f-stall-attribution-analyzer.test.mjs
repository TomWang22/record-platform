import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  STALL_CAPTURE_FIELDS,
  buildStallCaptureSnapshot,
  mergeStallCaptureFields,
} from '../scripts/lib/phase32-timing-attribution.mjs';
import {
  DEFAULT_OUT,
  OUTLIER_THRESHOLD_MS,
  analyzePhase32fStallAttribution,
  assertPhase32fPass,
} from '../scripts/lib/phase32f-stall-attribution-analyzer.mjs';

describe('phase32f stall attribution analyzer', () => {
  it('defines stall capture fields', () => {
    assert.ok(STALL_CAPTURE_FIELDS.includes('coordinator_lock_wait_ms'));
    assert.ok(STALL_CAPTURE_FIELDS.includes('curl_time_starttransfer_ms'));
    assert.ok(STALL_CAPTURE_FIELDS.includes('probe_gap_since_previous_ms'));
  });

  it('defaults missing stall fields to null', () => {
    const timing = buildStallCaptureSnapshot({ event_loop_delay_ms: 12.5 });
    assert.equal(timing.event_loop_delay_ms, 12.5);
    assert.equal(timing.coordinator_lock_wait_ms, null);
    assert.equal(timing.curl_error_class, null);
    assert.equal(timing.coordinator_stale_lock_recovered, false);
  });

  it('writes analyzer outputs only under /tmp', () => {
    const tmp = path.join('/tmp', `phase32f-test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    const phase31 = path.join(tmp, 'phase31');
  const phase32d = path.join(tmp, 'phase32d');
  const phase32e = path.join(tmp, 'phase32e');
  const out = path.join(tmp, 'analysis');
  for (const root of [phase31, phase32d, path.join(phase32e, 'baseline')]) {
    const shard = path.join(root, 'shard-h1');
    fs.mkdirSync(shard, { recursive: true });
    const row = {
      probe_id: 'p1',
      protocol_label: 'HTTP/1.1',
      matrix_protocol: 'h1',
      case_id: 'listing_advice',
      window: 1,
      run: 1,
      rag_total_ms: 250,
      http_status: 200,
      response_pass: 'PASS',
      completed_at: '2026-07-10T16:00:01.000Z',
      timing: mergeStallCaptureFields(
        {
          wall_total_ms: 250,
          curl_time_total_ms: 200,
          rag_total_ms: 180,
          coordinator_wait_ms: 0,
          window_reset_ms: 0,
          pre_probe_gate_verify_ms: 0,
          retry_count: 0,
          retry_delay_ms: 0,
          kpi_query_write_ms: 0,
          kpi_usefulness_write_ms: 0,
          jsonl_write_ms: 1,
          unattributed_ms: 49,
          probe_started_at: '2026-07-10T16:00:00.750Z',
          probe_finished_at: '2026-07-10T16:00:01.000Z',
        },
        { curl_time_starttransfer_ms: 150 },
      ),
    };
    fs.writeFileSync(path.join(shard, 'phase31-matrix.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
  }

    const report = analyzePhase32fStallAttribution({
      phase31Root: phase31,
      phase32dRoot: phase32d,
      phase32eRoot: phase32e,
      outDir: out,
    });
    assert.equal(report.status, 'PASS');
    assert.equal(report.summary.max_outlier_explained, false);
    assert.ok(fs.existsSync(path.join(out, 'phase32f-stall-attribution-summary.json')));
    assert.ok(fs.existsSync(path.join(out, 'phase32f-component-comparison.json')));
    assertPhase32fPass(report);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not mark tier-1 outlier explained without attribution', () => {
    assert.ok(OUTLIER_THRESHOLD_MS >= 1_000_000);
    assert.throws(
      () =>
        assertPhase32fPass({
          summary: {
            max_outlier_explained: true,
            production_ready_claim: false,
            production_enablement: 'NOT APPROVED',
          },
        }),
      /must not claim max outlier explained/,
    );
  });

  it('uses default /tmp output path constant', () => {
    assert.equal(DEFAULT_OUT, '/tmp/phase32f-latency-stall-analysis');
  });
});
