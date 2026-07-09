import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeMatrixRows,
  MATRIX_TARGET,
  MATRIX_EVIDENCE_LABEL,
} from '../scripts/lib/phase30-controlled-matrix-summary.mjs';

function sampleRow(proto, overrides = {}) {
  return {
    probe_id: 1,
    protocol_label: proto,
    http_version: proto === 'HTTP/1.1' ? '1.1' : proto === 'HTTP/2' ? '2' : '3',
    http_status: 200,
    version_ok: true,
    rag_total_ms: 100,
    gate_reason: 'preview_opt_in',
    expected_gate_reason: 'preview_opt_in',
    fallback_count: 0,
    response_pass: 'PASS',
    sentiment_pass: 'PASS',
    leakage_pass: 'PASS',
    case_id: 'listing_advice',
    evidence_label: MATRIX_EVIDENCE_LABEL,
    ...overrides,
  };
}

describe('phase30 controlled matrix summary', () => {
  it('uses Phase 30 staging evidence label', () => {
    assert.match(MATRIX_EVIDENCE_LABEL, /Phase 30 controlled staging KPI enablement matrix/);
  });

  it('summarizes per-protocol latency', () => {
    const rows = [sampleRow('HTTP/1.1'), sampleRow('HTTP/2'), sampleRow('HTTP/3')];
    const summary = summarizeMatrixRows(rows, { targetPerProtocol: 1 });
    assert.equal(summary.latency_by_protocol.length, 3);
    assert.equal(summary.fallback_count, 0);
  });

  it('expects full matrix target', () => {
    assert.equal(MATRIX_TARGET.total, 25920);
  });
});
