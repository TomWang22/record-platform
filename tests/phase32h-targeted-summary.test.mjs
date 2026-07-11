import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPhase32hSummary, scanPrivateFields } from '../scripts/lib/phase32h-targeted-summary.mjs';
import { TARGET_TOTAL } from '../scripts/lib/phase32h-targeted-reproduction-config.mjs';

describe('phase32h targeted summary', () => {
  const baseRow = (id, proto) => ({
    probe_id: id,
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
    evidence_label: 'Phase 32H targeted pre-first-byte latency reproduction matrix: 17280/17280 target',
    timing: {
      wall_total_ms: 500,
      curl_time_total_ms: 450,
      server_timing_rag_total_ms: 200,
    },
  });

  it('reports IN_PROGRESS until target total reached', () => {
    const rows = Array.from({ length: 100 }, (_, i) => baseRow(i + 1, 'HTTP/1.1'));
    const summary = buildPhase32hSummary('/tmp/phase32h-targeted-reproduction', rows);
    assert.equal(summary.status, 'IN_PROGRESS');
    assert.match(summary.matrix_total, /^\d+\/17280$/);
  });

  it('flags PASS_WITH_EXTREMES when gates pass but >=60s rows exist', () => {
    const protos = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'];
    const rows = [];
    let id = 0;
    for (const proto of protos) {
      for (let i = 0; i < TARGET_TOTAL / 3; i += 1) {
        id += 1;
        const row = baseRow(id, proto);
        if (i === 0) row.timing.wall_total_ms = 70_000;
        rows.push(row);
      }
    }
    const summary = buildPhase32hSummary('/tmp/phase32h-targeted-reproduction', rows);
    assert.equal(summary.matrix_total, `${TARGET_TOTAL}/${TARGET_TOTAL}`);
    assert.equal(summary.status, 'PASS_WITH_EXTREMES');
    assert.equal(summary.extreme_count, 3);
  });

  it('private field scan passes clean rows', () => {
    const rows = [baseRow(1, 'HTTP/1.1')];
    assert.equal(scanPrivateFields(rows).pass, true);
  });
});
