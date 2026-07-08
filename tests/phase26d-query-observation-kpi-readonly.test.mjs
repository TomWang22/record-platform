import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeQueryLatencyKpiFromObservations,
  summarizeQueryLatencyKpiHonest,
} from '../scripts/lib/phase26d-query-observation-kpi-readonly.mjs';

describe('phase26d query observation kpi readonly', () => {
  it('reports PASS with per-protocol p50/p95/max when rows exist for all protocols', () => {
    const result = summarizeQueryLatencyKpiFromObservations([
      { protocol: 'HTTP/1.1', rag_total_ms: 100, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
      { protocol: 'HTTP/2', rag_total_ms: 200, gate_reason: 'allowlist', workflow: 'rag_query', fallback_count: 1, canary_error_count: 0 },
      { protocol: 'HTTP/3', rag_total_ms: 300, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 1 },
    ]);
    assert.equal(result.status, 'PASS');
    assert.equal(result.kpi_query_observations_available, true);
    assert.equal(result.by_protocol['HTTP/1.1'].sample_count, 1);
    assert.equal(result.by_protocol['HTTP/2'].p50_ms, 200);
    assert.equal(result.by_protocol['HTTP/3'].max_ms, 300);
    assert.equal(result.by_gate_reason.allowlist, 1);
    assert.equal(result.by_workflow.rag_query, 3);
    assert.equal(result.fallback_count, 1);
    assert.equal(result.canary_error_count, 1);
  });

  it('reports PARTIAL when only some protocols have rows', () => {
    const result = summarizeQueryLatencyKpiFromObservations([
      { protocol: 'HTTP/2', rag_total_ms: 150, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
    ]);
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.by_protocol['HTTP/2'].sample_count, 1);
    assert.equal(result.by_protocol['HTTP/1.1'].sample_count, 0);
  });

  it('reports GAP honestly when no observation rows', () => {
    const result = summarizeQueryLatencyKpiHonest([]);
    assert.equal(result.status, 'GAP');
    assert.equal(result.kpi_query_observations_available, false);
    assert.equal(result.by_protocol['HTTP/1.1'].sample_count, 0);
    assert.equal(result.h1_full_matrix_committed_docs.status, 'GAP');
  });

  it('does not invent H1 full-matrix latency from observation rows alone', () => {
    const result = summarizeQueryLatencyKpiFromObservations([
      { protocol: 'HTTP/1.1', rag_total_ms: 120, gate_reason: 'keyword_default', workflow: 'rag_query', fallback_count: 0, canary_error_count: 0 },
    ]);
    assert.equal(result.h1_full_matrix_committed_docs.status, 'GAP');
  });
});
