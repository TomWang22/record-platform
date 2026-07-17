/**
 * Phase 34 live fail-closed protocol acceptance gates.
 * Any hard protocol failure must stop release of the next logical session.
 */
export const PHASE34_PROTOCOL_ACCEPTANCE_FAILURE = 'PHASE34_PROTOCOL_ACCEPTANCE_FAILURE';
export const PHASE34_LIVE_BLOCK_MARKER = 'PHASE34_LIVE_PROTOCOL_BLOCKED';

/**
 * Classify a single protocol probe row as a hard live stop.
 * @param {{ ok?: boolean, http_status?: number|null, error_class?: string|null, wrong_gate?: boolean, wrong_protocol?: boolean, h2_fallback?: boolean, h3_fallback?: boolean, material_parity_failure?: boolean, schema_failure?: boolean, privacy_violation?: boolean, safety_violation?: boolean, production_mutation?: boolean }} row
 */
export function classifyHardProtocolFailure(row = {}) {
  if (!row || typeof row !== 'object') return null;
  if (row.privacy_violation) return 'PRIVACY_VIOLATION';
  if (row.safety_violation) return 'SAFETY_VIOLATION';
  if (row.production_mutation) return 'PRODUCTION_MUTATION';
  if (row.schema_failure) return 'SCHEMA_FAILURE';
  if (row.material_parity_failure) return 'MATERIAL_PARITY_FAILURE';
  if (row.wrong_gate) return 'WRONG_GATE';
  if (row.wrong_protocol) return 'WRONG_PROTOCOL';
  if (row.h2_fallback) return 'H2_FALLBACK';
  if (row.h3_fallback) return 'H3_FALLBACK';
  const status = Number(row.http_status);
  if (status === 429 || row.error_class === 'EDGE_RATE_LIMITED') return 'HTTP_429';
  if (status === 422) return 'HTTP_422';
  if (Number.isFinite(status) && status >= 500) return 'HTTP_5XX';
  if (status === 0 || row.http_status == null) {
    if (String(row.error_class || '').startsWith('curl') || row.error_class === 'curl_failed') {
      return 'CURL_FAILURE';
    }
    return 'HTTP_0';
  }
  if (String(row.error_class || '').startsWith('curl') || row.error_class === 'curl_failed') {
    return 'CURL_FAILURE';
  }
  if (row.ok === false) return 'PROTOCOL_ROW_FAILURE';
  return null;
}

/**
 * Evaluate a synchronized triplet: record siblings, then decide whether to stop.
 * @param {Record<string, object>} resultsByProtocol map of h1/h2/h3 probe results
 */
export function evaluateLiveTripletFailClosed(resultsByProtocol = {}) {
  const rows = Object.values(resultsByProtocol || {});
  const protocolFailures = [];
  for (const row of rows) {
    const cls = classifyHardProtocolFailure(row);
    if (cls) {
      protocolFailures.push({
        protocol: row.protocol || null,
        probe_id: row.probe_id || null,
        http_status: row.http_status ?? null,
        error_class: row.error_class || null,
        failure_class: cls,
      });
    }
  }
  const logicalFailed = protocolFailures.length > 0 || rows.some((r) => r && r.ok === false);
  return {
    stop: protocolFailures.length > 0,
    logical_failed: logicalFailed,
    protocol_failure_count: protocolFailures.length,
    logical_failure_count: logicalFailed ? 1 : 0,
    failure_class: protocolFailures[0]?.failure_class || null,
    protocol_failures: protocolFailures,
    code: protocolFailures.length > 0 ? PHASE34_PROTOCOL_ACCEPTANCE_FAILURE : null,
  };
}
