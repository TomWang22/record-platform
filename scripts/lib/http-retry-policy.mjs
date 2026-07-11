/**
 * HTTP retry policy for matrix probes and RAG queries.
 * Deterministic 4xx (including 422) must fail fast — no gateway-style backoff.
 */

export const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);

const DETERMINISTIC_4XX = new Set([400, 401, 403, 404, 409, 422]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP_STATUSES.has(Number(status));
}

export function isDeterministicHttpStatus(status) {
  const code = Number(status);
  return code >= 400 && code < 500 && !isTransientHttpStatus(code);
}

export function shouldRetryRagQuery(httpStatus) {
  return isTransientHttpStatus(httpStatus);
}

export function probeAttemptDelayMs(attempt, httpStatus) {
  if (httpStatus === 429) {
    return Math.min(8000, 250 * 2 ** attempt);
  }
  return Math.min(10000, 500 * 2 ** attempt);
}

/**
 * Whether executeProbe should sleep and retry after a completed HTTP response.
 */
export function shouldRetryProbeResponse({ http_status, retrieval_mode, attempt, maxAttempts }) {
  if (attempt + 1 >= maxAttempts) return false;
  if (isTransientHttpStatus(http_status)) return true;
  if (isDeterministicHttpStatus(http_status)) return false;
  if (http_status !== 200) return false;
  if (retrieval_mode === 'keyword_fallback_from_hybrid') return true;
  return false;
}

export function classifyHttp422RootCause(body = {}) {
  const code = body.error_code || body.code || body.details?.error_code;
  const detail = body.error || body.detail || body.details?.error || body.message;
  const text = `${code || ''} ${detail || ''}`.toLowerCase();
  if (text.includes('schema') || text.includes('validation')) return 'REQUEST_SCHEMA_422';
  if (text.includes('identity') || text.includes('user_id') || text.includes('mismatch')) {
    return 'IDENTITY_MISMATCH_422';
  }
  if (text.includes('enroll') || text.includes('preview')) return 'PREVIEW_ENROLLMENT_MISSING_422';
  if (text.includes('gate')) return 'SERVICE_GATE_BUG';
  return 'UNKNOWN';
}
