import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeMatrixRows,
  MATRIX_TARGET,
  MATRIX_EVIDENCE_LABEL,
  assertRedactedRow,
} from '../scripts/lib/phase29-controlled-matrix-summary.mjs';

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
    sentiment_required: false,
    red_team_case: false,
    evidence_label: MATRIX_EVIDENCE_LABEL,
    ...overrides,
  };
}

describe('phase29 controlled matrix summary', () => {
  it('summarizes per-protocol latency table', () => {
    const rows = [
      sampleRow('HTTP/1.1', { rag_total_ms: 100 }),
      sampleRow('HTTP/2', { rag_total_ms: 120, gate_reason: 'allowlist', expected_gate_reason: 'allowlist' }),
      sampleRow('HTTP/3', { rag_total_ms: 130 }),
    ];
    const summary = summarizeMatrixRows(rows, { targetPerProtocol: 1 });
    assert.equal(summary.latency_by_protocol.length, 3);
    assert.equal(summary.fallback_count, 0);
    assert.equal(summary.leakage_failures, 0);
  });

  it('flags BLOCKED when wrong protocol at full matrix size', () => {
    const rows = Array.from({ length: MATRIX_TARGET.total }, (_, i) => {
      const proto = i % 3 === 0 ? 'HTTP/1.1' : i % 3 === 1 ? 'HTTP/2' : 'HTTP/3';
      return sampleRow(proto, { probe_id: i + 1, version_ok: i !== 0 });
    });
    rows[0] = sampleRow('HTTP/1.1', { probe_id: 1, version_ok: false });
    const summary = summarizeMatrixRows(rows);
    assert.ok(summary.wrong_protocol_count >= 1);
    assert.equal(summary.status, 'BLOCKED');
  });

  it('uses Phase 29 evidence label', () => {
    assert.match(MATRIX_EVIDENCE_LABEL, /Phase 29 controlled observability production-enablement matrix/);
  });

  it('rejects rows with private fields', () => {
    assert.throws(() => assertRedactedRow({ jwt: 'secret' }), /private|forbidden|jwt/i);
  });
});
