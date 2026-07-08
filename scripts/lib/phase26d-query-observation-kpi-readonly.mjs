/**
 * Phase 26D — query latency KPI aggregation from ai_kpi_query_observations (read-only).
 */

const PROTOCOL_LABELS = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

function summarizeTiming(values) {
  if (!values.length) {
    return { p50_ms: null, p95_ms: null, max_ms: null, sample_count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    max_ms: sorted[sorted.length - 1],
    sample_count: sorted.length,
  };
}

function emptyByProtocol() {
  return Object.fromEntries(
    PROTOCOL_LABELS.map((protocol) => [protocol, summarizeTiming([])]),
  );
}

function countByField(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row[field] == null || row[field] === '' ? 'unknown' : String(row[field]);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function summarizeQueryLatencyKpiFromObservations(observationRows) {
  if (!Array.isArray(observationRows) || observationRows.length === 0) {
    return {
      status: 'GAP',
      source: 'uninstrumented_fallback',
      kpi_query_observations_available: false,
      by_protocol: emptyByProtocol(),
      by_gate_reason: {},
      by_workflow: {},
      fallback_count: 0,
      canary_error_count: 0,
      h1_full_matrix_committed_docs: {
        status: 'GAP',
        reason: 'No committed full-matrix H1 p50/p95/max summary in archive docs',
      },
      notes: [
        'No ai.ai_kpi_query_observations rows available',
        'Do not invent protocol latency without observation rows',
      ],
    };
  }

  const byProtocol = emptyByProtocol();
  for (const protocol of PROTOCOL_LABELS) {
    const values = observationRows
      .filter((row) => row.protocol === protocol)
      .map((row) => toNumber(row.rag_total_ms))
      .filter((v) => v >= 0);
    byProtocol[protocol] = summarizeTiming(values);
  }

  const protocolsWithSamples = PROTOCOL_LABELS.filter(
    (protocol) => byProtocol[protocol].sample_count > 0,
  );

  let status = 'PASS';
  if (!protocolsWithSamples.length) {
    status = 'GAP';
  } else if (protocolsWithSamples.length < PROTOCOL_LABELS.length) {
    status = 'PARTIAL';
  }

  const fallbackCount = observationRows.reduce(
    (sum, row) => sum + toNumber(row.fallback_count),
    0,
  );
  const canaryErrorCount = observationRows.reduce(
    (sum, row) => sum + toNumber(row.canary_error_count),
    0,
  );

  return {
    status,
    source: 'ai.ai_kpi_query_observations',
    kpi_query_observations_available: true,
    by_protocol: byProtocol,
    by_gate_reason: countByField(observationRows, 'gate_reason'),
    by_workflow: countByField(observationRows, 'workflow'),
    fallback_count: fallbackCount,
    canary_error_count: canaryErrorCount,
    h1_full_matrix_committed_docs: {
      status: 'GAP',
      reason: 'No committed full-matrix H1 p50/p95/max summary in archive docs',
      note: 'Observation rows do not backfill committed H1 matrix evidence',
    },
    notes: [
      'rag_total_ms derived from ai.ai_kpi_query_observations only',
      'PARTIAL when only some protocols have observation rows',
    ],
  };
}

export function summarizeQueryLatencyKpiHonest(observationRows) {
  return summarizeQueryLatencyKpiFromObservations(observationRows);
}
