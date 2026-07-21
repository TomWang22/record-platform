/**
 * Pure SaleCompleted outbox drain core (testable without Kafka/PG).
 * Production shopping-service mirrors this algorithm in sale-completed-outbox-drain.ts.
 */
import crypto from 'node:crypto';

export function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

export function backoffMs(retryCount) {
  const base = 1000 * Math.pow(2, Math.min(retryCount, 6));
  return Math.min(base, 60_000);
}

export function parseOutboxPayload(payload) {
  const text = Buffer.isBuffer(payload)
    ? payload.toString('utf8')
    : typeof payload === 'string'
      ? payload
      : Buffer.from(payload).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const e = new Error(`MALFORMED_OUTBOX_PAYLOAD:${err?.message || err}`);
    e.code = 'MALFORMED_OUTBOX_PAYLOAD';
    throw e;
  }
  return { text, parsed };
}

export function buildPublishHeaders(row, parsed, sourceSha) {
  const inner = parsed.payload || parsed;
  const meta = parsed.metadata || {};
  const eventId = String(meta.event_id || row.id);
  return {
    event_id: eventId,
    market_event_id: String(inner.market_event_id || ''),
    event_type: 'SaleCompleted',
    schema_version: '1',
    producer: 'shopping-service',
    source_sha: sourceSha,
    correlation_id: String(inner.sale_event_id || eventId),
    trace_id: String(meta.trace_id || ''),
    occurred_at: String(inner.completed_at || meta.occurred_at || ''),
    payload_hash: row.payload_hash || sha256(parsed),
    idempotency_key: String(row.idempotency_key || eventId),
  };
}

/**
 * @param {object} deps
 * @param {number} [limit]
 * @param {{ maxRetries?: number, now?: () => Date, owner?: string, sourceSha?: string }} [opts]
 */
export async function drainSaleCompletedOutboxCore(deps, limit = 25, opts = {}) {
  const result = {
    scanned: 0,
    published: 0,
    normalized: 0,
    retried: 0,
    dead_lettered: 0,
    errors: [],
  };
  const maxRetries = opts.maxRetries ?? 8;
  const owner = opts.owner || 'test-drain';
  const sourceSha = opts.sourceSha || 'test-sha';
  const now = opts.now || (() => new Date());

  const rows = await deps.leaseBatch(limit, owner, 30_000);
  result.scanned = rows.length;

  for (const row of rows) {
    const retryCount = Number(row.retry_count || 0);
    try {
      const { text, parsed } = parseOutboxPayload(row.payload);
      const headers = buildPublishHeaders(row, parsed, sourceSha);
      const ack = await deps.publish(row, text, headers);
      result.published += 1;
      await deps.normalize(parsed, row);
      result.normalized += 1;
      await deps.markPublished(row, ack);
    } catch (err) {
      const msg = String(err?.message || err);
      result.errors.push(`OUTBOX_${row.id}:${msg}`);
      if (err?.code === 'MALFORMED_OUTBOX_PAYLOAD' || retryCount + 1 >= maxRetries) {
        await deps.markDeadLetter(row, msg);
        result.dead_lettered += 1;
      } else {
        const next = new Date(now().getTime() + backoffMs(retryCount));
        await deps.markRetry(row, msg, next);
        result.retried += 1;
      }
    }
  }
  return result;
}
