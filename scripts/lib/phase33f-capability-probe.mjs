/**
 * Phase 33F single-probe issuance (shared by runner + worker threads).
 */
import {
  curlRequest,
  PROTOCOLS as CURL_PROTOCOLS,
  DEFAULTS,
} from './phase22-full-replay-common.mjs';
import { CAPABILITY_ROUTE_PATHS } from './phase33f-canary-config.mjs';
import { classifyHttpError, EDGE_RATE_LIMITED } from './phase33f-rate-limit.mjs';

export function capabilityRoutePath(capability) {
  const route = CAPABILITY_ROUTE_PATHS[capability];
  if (!route) {
    const _exhaustive = capability;
    throw new Error(`unknown capability route: ${_exhaustive}`);
  }
  return route;
}

function expectedHttpOk(row) {
  const behavior = String(row.expected_behavior || '');
  if (
    behavior === 'refuse' ||
    behavior === 'deterministic_4xx' ||
    behavior === 'unauthorized_refusal'
  ) {
    return false;
  }
  const request = row.request || {};
  // Negotiation Contract A: unauthorized_thread → structured HTTP 200 refusal.
  if (
    row.capability === 'negotiation_assistance' &&
    (behavior === 'abstain_or_limit' ||
      request.mode === 'unauthorized_thread' ||
      row.capability_mode === 'unauthorized_thread' ||
      request.unauthorized_thread === true)
  ) {
    return true;
  }
  if (
    request.unauthorized_scope ||
    request.cross_user_attempt ||
    request.deleted_source ||
    request.unauthorized_watchlist ||
    request.unauthorized_thread
  ) {
    return false;
  }
  // privacy_adversarial alone means "assert no leakage", not "expect HTTP 4xx".
  return true;
}

function buildRequestBody(row) {
  const body = {
    ...row.request,
    capability: row.capability,
    capability_mode: row.capability_mode,
    schema_version: row.schema_version,
    principal_fixture: row.principal_fixture,
    authorization_scopes: row.authorization_scopes,
    prohibited_scopes: row.prohibited_scopes,
    conversation_or_session_id: row.conversation_or_session_id,
    turns: row.turns,
    memory_classes: row.memory_classes,
    seed: row.seed,
    production_mutation_allowed: false,
  };
  // Carry side/mode into the engine path without flipping expected HTTP via
  // unauthorized_thread boolean (Contract A expects structured HTTP 200).
  if (row.participant_side && body.participant_side == null) {
    body.participant_side = row.participant_side;
  }
  return body;
}

export function issueCapabilityProbe(row, {
  baseUrl = DEFAULTS.baseUrl,
  caCert = DEFAULTS.caCert,
  curlResolve = process.env.CURL_RESOLVE || null,
  executeCurl = curlRequest,
  token = null,
  userId = null,
} = {}) {
  const protocol = CURL_PROTOCOLS[row.protocol];
  if (!protocol) throw new Error(`unknown protocol: ${row.protocol}`);
  const adversarial = Boolean(row.tags?.privacy_adversarial);
  const urlPath = capabilityRoutePath(row.capability);
  const body = buildRequestBody(row);
  const started_at = new Date().toISOString();
  let result;
  try {
    result = executeCurl({
      method: 'POST',
      urlPath,
      token,
      userId: userId || row.principal_fixture,
      body,
      protocolFlag: protocol.flag,
      expectedVersion: protocol.expected,
      baseUrl,
      caCert,
      curlResolve,
    });
  } catch (err) {
    const status = err.http_status != null ? Number(err.http_status) : null;
    const rate = classifyHttpError({
      http_status: status,
      body_format: err.body_format,
      headers: err.headers || {},
    });
    return {
      probe_id: row.probe_id,
      batch_id: row.batch_id,
      capability: row.capability,
      protocol: row.protocol,
      started_at,
      finished_at: new Date().toISOString(),
      http_status: status,
      http_version: err.http_version ?? null,
      headers: err.headers || null,
      body_format: err.body_format || null,
      json_parse_status: err.json_parse_status || null,
      body_raw_prefix: err.body_raw_prefix || null,
      curl_exit_code: err.curl_exit_code ?? 1,
      curl_error_class: err.curl_error_class || 'curl_failed',
      error: String(err.message || err),
      error_class: rate?.error_class || err.curl_error_class || 'curl_failed',
      error_code: rate?.error_code || null,
      retry_after_ms: rate?.retry_after_ms ?? null,
      retries: 0,
      expected_4xx: adversarial,
      ok: false,
    };
  }
  const status = Number(result.http_status);
  const rate = classifyHttpError({
    http_status: status,
    body_format: result.body_format,
    headers: result.headers || {},
  });
  if (rate?.error_class === EDGE_RATE_LIMITED) {
    return {
      probe_id: row.probe_id,
      batch_id: row.batch_id,
      capability: row.capability,
      protocol: row.protocol,
      started_at,
      finished_at: new Date().toISOString(),
      http_status: 429,
      http_version: result.http_version,
      curl_time_total_ms: result.curl_time_total_ms,
      version_ok: result.version_ok,
      headers: result.headers || null,
      body: result.body,
      body_format: result.body_format,
      json_parse_status: result.json_parse_status,
      body_raw_prefix: result.body_raw_prefix,
      body_sha256: result.body_sha256,
      error_class: EDGE_RATE_LIMITED,
      error_code: EDGE_RATE_LIMITED,
      limiter_scope: rate.limiter_scope,
      retry_after_ms: rate.retry_after_ms,
      retries: 0,
      retry_count: 0,
      expected_4xx: adversarial,
      zero_retries: true,
      ok: false,
    };
  }
  const expectOk = expectedHttpOk(row);
  const is4xx = status >= 400 && status < 500;
  const ok = expectOk ? status === 200 && result.version_ok : is4xx;
  return {
    probe_id: row.probe_id,
    batch_id: row.batch_id,
    capability: row.capability,
    protocol: row.protocol,
    started_at,
    finished_at: new Date().toISOString(),
    http_status: status,
    http_version: result.http_version,
    curl_time_total_ms: result.curl_time_total_ms,
    version_ok: result.version_ok,
    headers: result.headers || null,
    body: result.body,
    body_format: result.body_format || null,
    json_parse_status: result.json_parse_status || null,
    body_raw_prefix: result.body_raw_prefix || null,
    body_sha256: result.body_sha256 || null,
    retries: 0,
    expected_4xx: adversarial,
    zero_retries: true,
    ok,
  };
}
