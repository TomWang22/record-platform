import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPhase32dReport } from '../scripts/phase32d-summarize-timing-attribution.mjs';
import { MATRIX_TARGET } from '../scripts/lib/phase32d-controlled-matrix-config.mjs';

function sampleRow(overrides = {}) {
  return {
    probe_id: 1,
    matrix_protocol: 'h1',
    protocol_label: 'HTTP/1.1',
    window: 1,
    run: 1,
    case_id: 'listing_advice',
    user_uid_hash: 'abc123',
    user_class: 'real_participant',
    http_status: 200,
    version_ok: true,
    rag_total_ms: 300,
    gate_reason: 'preview_opt_in',
    expected_gate_reason: 'preview_opt_in',
    fallback_count: 0,
    response_pass: 'PASS',
    sentiment_pass: 'PASS',
    leakage_pass: 'PASS',
    evidence_label: 'phase32d-test',
    timing: {
      probe_started_at: '2026-07-10T16:00:00.000Z',
      probe_finished_at: '2026-07-10T16:00:00.500Z',
      wall_total_ms: 500,
      curl_time_total_ms: 320,
      rag_total_ms: 300,
      coordinator_wait_ms: 0,
      window_reset_ms: 0,
      pre_probe_gate_verify_ms: 0,
      retry_count: 0,
      retry_delay_ms: 0,
      kpi_query_write_ms: 10,
      kpi_usefulness_write_ms: 0,
      jsonl_write_ms: 1,
      unattributed_ms: 169,
    },
    ...overrides,
  };
}

describe('phase32d timing attribution summary', () => {
  it('uses 3888 micro-soak target', () => {
    assert.equal(MATRIX_TARGET.total, 3888);
    assert.equal(MATRIX_TARGET.perProtocol, 1296);
  });

  it('blocks when rag_total_ms not fully populated', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32d-sum-'));
    const shard = path.join(tmp, 'shard-h1');
    fs.mkdirSync(shard, { recursive: true });
    const row = sampleRow({ timing: { ...sampleRow().timing, rag_total_ms: null } });
    fs.writeFileSync(path.join(shard, 'phase31-matrix.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
    const report = buildPhase32dReport(tmp);
    assert.equal(report.attribution_verdict.app_timing_exposure_blocked, true);
    assert.equal(report.status, 'BLOCKED');
  });

  it('classifies outlier reproduction threshold', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32d-sum-'));
    const shard = path.join(tmp, 'shard-h1');
    fs.mkdirSync(shard, { recursive: true });
    const row = sampleRow({
      timing: {
        ...sampleRow().timing,
        wall_total_ms: 1_037_645,
        rag_total_ms: 1_037_645,
        curl_time_total_ms: 1_037_645,
      },
    });
    fs.writeFileSync(path.join(shard, 'phase31-matrix.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
    const report = buildPhase32dReport(tmp);
    assert.equal(report.attribution_verdict.seventeen_minute_outlier_reproduced, 'YES');
  });
});
