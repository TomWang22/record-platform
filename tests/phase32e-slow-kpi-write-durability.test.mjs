import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPhase32eReport } from '../scripts/phase32e-summarize-slow-kpi-write-durability.mjs';
import { MATRIX_TARGET, MODES } from '../scripts/lib/phase32e-controlled-matrix-config.mjs';

function sampleRow(overrides = {}) {
  return {
    probe_id: 1,
    matrix_protocol: 'h1',
    protocol_label: 'HTTP/1.1',
    window: 1,
    run: 1,
    case_id: 'listing_advice',
    user_uid_hash: 'abc',
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
    query_observation_write: 'PASS',
    usefulness_write: 'PASS',
    evidence_label: 'phase32e-test',
    timing: {
      wall_total_ms: 500,
      curl_time_total_ms: 320,
      rag_total_ms: 300,
      kpi_query_write_ms: 40,
      kpi_usefulness_write_ms: 0,
      unattributed_ms: 140,
    },
    ...overrides,
  };
}

describe('phase32e slow kpi write durability', () => {
  it('defines three injection modes', () => {
    assert.ok(MODES.baseline);
    assert.ok(MODES.slow_write);
    assert.ok(MODES.failing_write);
    assert.equal(MODES.slow_write.AI_KPI_TEST_INJECT_WRITE_DELAY_MS, '500');
    assert.equal(MODES.failing_write.AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE, '1');
  });

  it('uses 1296 micro-soak target', () => {
    assert.equal(MATRIX_TARGET.total, 1296);
    assert.equal(MATRIX_TARGET.perProtocol, 432);
  });

  it('blocks when failing mode has no kpi write failures', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase32e-'));
    for (const mode of ['baseline', 'slow_write', 'failing_write']) {
      const shard = path.join(tmp, mode, 'shard-h1');
      fs.mkdirSync(shard, { recursive: true });
      const row = sampleRow(
        mode === 'failing_write'
          ? { query_observation_write: 'PASS', usefulness_write: 'PASS' }
          : {},
      );
      fs.writeFileSync(path.join(shard, 'phase31-matrix.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');
    }
    const report = buildPhase32eReport(tmp);
    assert.equal(report.status, 'BLOCKED');
  });
});
