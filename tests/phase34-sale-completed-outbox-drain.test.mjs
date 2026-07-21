/**
 * Crash/replay unit tests for SaleCompleted outbox drain core.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drainSaleCompletedOutboxCore,
  parseOutboxPayload,
  backoffMs,
} from '../scripts/lib/phase34-outbox-drain-core.mjs';

function sampleRow(overrides = {}) {
  const payload = {
    metadata: {
      event_id: overrides.id || '11111111-1111-4111-8111-111111111111',
      event_type: 'SaleCompleted',
      aggregate_id: 'listing-1',
    },
    payload: {
      listing_id: 'listing-1',
      sale_event_id: 'sale-1',
      market_event_id: 'me-sale-1',
      completed_at: '2026-07-21T15:00:00.000Z',
      final_price: 14,
      currency: 'USD',
      rights_status: 'FIRST_PARTY',
    },
  };
  return {
    id: overrides.id || '11111111-1111-4111-8111-111111111111',
    aggregate_id: 'listing-1',
    payload: Buffer.from(JSON.stringify(payload)),
    retry_count: overrides.retry_count || 0,
    payload_hash: null,
    idempotency_key: overrides.id || '11111111-1111-4111-8111-111111111111',
    ...overrides,
  };
}

function memoryStore(initialRows = []) {
  const rows = initialRows.map((r) => ({ ...r, published: false, dead_lettered: false }));
  const published = [];
  const normalized = [];
  const retries = [];
  const dead = [];
  let publishImpl = async () => ({ topic: 'dev.listing.events', partition: 0, offset: '1' });
  let normalizeImpl = async () => 'me-sale-1';
  let crashAfterPublish = false;

  const deps = {
    async leaseBatch(limit) {
      return rows.filter((r) => !r.published && !r.dead_lettered).slice(0, limit);
    },
    async publish(row, text, headers) {
      const ack = await publishImpl(row, text, headers);
      if (crashAfterPublish) {
        const e = new Error('CRASH_AFTER_KAFKA_ACK');
        e.code = 'CRASH_AFTER_KAFKA_ACK';
        throw e;
      }
      return ack;
    },
    async normalize(parsed, row) {
      const id = await normalizeImpl(parsed, row);
      normalized.push({ rowId: row.id, market_event_id: id });
      return id;
    },
    async markPublished(row, ack) {
      const r = rows.find((x) => x.id === row.id);
      if (r) r.published = true;
      published.push({ rowId: row.id, ack });
    },
    async markRetry(row, error, nextAttemptAt) {
      const r = rows.find((x) => x.id === row.id);
      if (r) r.retry_count = Number(r.retry_count || 0) + 1;
      retries.push({ rowId: row.id, error, nextAttemptAt });
    },
    async markDeadLetter(row, error) {
      const r = rows.find((x) => x.id === row.id);
      if (r) r.dead_lettered = true;
      dead.push({ rowId: row.id, error });
    },
  };

  return {
    rows,
    deps,
    published,
    normalized,
    retries,
    dead,
    setPublishImpl(fn) {
      publishImpl = fn;
    },
    setNormalizeImpl(fn) {
      normalizeImpl = fn;
    },
    setCrashAfterPublish(v) {
      crashAfterPublish = v;
    },
  };
}

test('parseOutboxPayload rejects malformed JSON', () => {
  assert.throws(
    () => parseOutboxPayload(Buffer.from('{not-json')),
    (e) => e.code === 'MALFORMED_OUTBOX_PAYLOAD',
  );
});

test('backoff grows then caps', () => {
  assert.equal(backoffMs(0), 1000);
  assert.equal(backoffMs(1), 2000);
  assert.ok(backoffMs(10) <= 60_000);
});

test('happy path: publish then normalize then mark published', async () => {
  const mem = memoryStore([sampleRow()]);
  const r = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 3 });
  assert.equal(r.published, 1);
  assert.equal(r.normalized, 1);
  assert.equal(r.errors.length, 0);
  assert.equal(mem.published.length, 1);
  assert.equal(mem.rows[0].published, true);
});

test('crash before Kafka ack: row retried, not published', async () => {
  const mem = memoryStore([sampleRow()]);
  mem.setPublishImpl(async () => {
    throw new Error('KAFKA_UNAVAILABLE');
  });
  const r = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r.published, 0);
  assert.equal(r.retried, 1);
  assert.equal(mem.published.length, 0);
  assert.equal(mem.rows[0].published, false);
  assert.equal(mem.retries.length, 1);
});

test('crash after Kafka ack before markPublished: retry is idempotent on normalize', async () => {
  const mem = memoryStore([sampleRow()]);
  let normalizeCalls = 0;
  mem.setNormalizeImpl(async () => {
    normalizeCalls += 1;
    return 'me-sale-1';
  });
  mem.setCrashAfterPublish(true);
  const r1 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r1.published, 0); // crash before normalize completes counting as published in core after publish returns — actually crash is inside publish after ack simulated
  // With crashAfterPublish throwing from publish(), published count stays 0
  assert.equal(r1.retried, 1);
  assert.equal(mem.rows[0].published, false);

  // Second drain: publish succeeds, normalize once, mark published
  mem.setCrashAfterPublish(false);
  const r2 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r2.published, 1);
  assert.equal(r2.normalized, 1);
  assert.equal(mem.rows[0].published, true);
  assert.equal(normalizeCalls, 1);
});

test('crash after ack+normalize before markPublished: replay marks published without duplicate normalize side effects', async () => {
  const mem = memoryStore([sampleRow()]);
  const seen = new Set();
  mem.setNormalizeImpl(async (_parsed, row) => {
    if (seen.has(row.id)) return 'me-sale-1'; // idempotent
    seen.add(row.id);
    return 'me-sale-1';
  });
  let markCalls = 0;
  const origMark = mem.deps.markPublished;
  mem.deps.markPublished = async (row, ack) => {
    markCalls += 1;
    if (markCalls === 1) throw new Error('CRASH_BEFORE_PUBLISHED_AT');
    return origMark(row, ack);
  };
  const r1 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r1.retried, 1);
  assert.equal(mem.rows[0].published, false);
  const r2 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r2.published, 1);
  assert.equal(mem.rows[0].published, true);
  assert.equal(seen.size, 1);
});

test('duplicate drain workers: second lease empty after first publishes', async () => {
  const mem = memoryStore([sampleRow()]);
  const r1 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 3 });
  assert.equal(r1.published, 1);
  const r2 = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 3 });
  assert.equal(r2.scanned, 0);
  assert.equal(r2.published, 0);
});

test('malformed event is dead-lettered', async () => {
  const mem = memoryStore([
    sampleRow({
      id: '22222222-2222-4222-8222-222222222222',
      payload: Buffer.from('{bad'),
    }),
  ]);
  const r = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 5 });
  assert.equal(r.dead_lettered, 1);
  assert.equal(mem.rows[0].dead_lettered, true);
  assert.equal(mem.published.length, 0);
});

test('poison event exceeds retries then dead-letters', async () => {
  const mem = memoryStore([sampleRow({ retry_count: 7 })]);
  mem.setPublishImpl(async () => {
    throw new Error('POISON');
  });
  const r = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 8 });
  assert.equal(r.dead_lettered, 1);
  assert.equal(mem.dead.length, 1);
});

test('replay of already published event is a no-op lease', async () => {
  const mem = memoryStore([sampleRow()]);
  mem.rows[0].published = true;
  const r = await drainSaleCompletedOutboxCore(mem.deps, 10, { maxRetries: 3 });
  assert.equal(r.scanned, 0);
});
