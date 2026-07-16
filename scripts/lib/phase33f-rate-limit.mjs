/**
 * Phase 33F rate-limit taxonomy and canary pacing policy.
 *
 * Proven limiter: api-gateway express-rate-limit
 *   windowMs=60000, max=300, identity=IP, global across routes/protocols.
 */
export const RATE_POLICY_VERSION = 'phase33f-rate-v1';

/** Gateway express-rate-limit (services/api-gateway/src/app.ts). */
export const GATEWAY_RATE_LIMIT_MAX = 300;
export const GATEWAY_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Deterministic inter-batch interval (ms) between synchronized triplets.
 * Selected for ≥20% margin below 300/min shared IP bucket:
 *   1000ms → ≤180 req/min when batches complete quickly.
 */
export const INTER_BATCH_INTERVAL_MS = 1000;
export const INTER_BATCH_INTERVAL_MIN_MS = 750;
export const TRIPLET_START_SPREAD_LIMIT_MS = 100;

export const EDGE_RATE_LIMITED = 'EDGE_RATE_LIMITED';

export function parseRetryAfterMs(headers = {}) {
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (raw == null || raw === '') return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum * 1000);
  const when = Date.parse(String(raw));
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

export function classifyHttpError({ http_status, body_format, headers = {} } = {}) {
  const status = Number(http_status);
  if (status === 429) {
    return {
      error_code: EDGE_RATE_LIMITED,
      error_class: EDGE_RATE_LIMITED,
      http_status: 429,
      body_format: body_format || null,
      retry_after_ms: parseRetryAfterMs(headers),
      limiter_scope: 'api-gateway:express-rate-limit:ip-global',
      retry_count: 0,
    };
  }
  return null;
}

export function assertInterBatchInterval(intervalMs) {
  const n = Number(intervalMs);
  if (!Number.isFinite(n) || n < INTER_BATCH_INTERVAL_MIN_MS) {
    const err = new Error(
      `inter_batch_interval_ms ${intervalMs} below approved minimum ${INTER_BATCH_INTERVAL_MIN_MS}`,
    );
    err.code = 'PHASE33F_RATE_PACING_INVALID';
    throw err;
  }
  return n;
}

/** Target / target-smoke require the full phase33f-rate-v1 floor (1000 ms), not the 750 ms floor. */
export function assertTargetInterBatchInterval(intervalMs) {
  const n = Number(intervalMs);
  if (!Number.isFinite(n) || n < INTER_BATCH_INTERVAL_MS) {
    const err = new Error(
      `target inter_batch_interval_ms ${intervalMs} below required ${INTER_BATCH_INTERVAL_MS}`,
    );
    err.code = 'PHASE33F_TARGET_RATE_PACING_INVALID';
    throw err;
  }
  return n;
}

export function projectedCanaryRuntimeMs({
  batches = 240,
  interBatchIntervalMs = INTER_BATCH_INTERVAL_MS,
  avgBatchDurationMs = 150,
} = {}) {
  return batches * (Number(interBatchIntervalMs) + Number(avgBatchDurationMs));
}

export function sleepMs(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}
