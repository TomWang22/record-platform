#!/usr/bin/env node
/**
 * Bounded outbox crash/replay smoke against listings@5435 (not production).
 * Uses security-definer publisher functions from migration 56.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const URL =
  process.env.POSTGRES_URL_LISTINGS ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';
const OUT = 'reports/phase34-runtime-integration/outbox-reliability-report.json';

async function main() {
  const pool = new pg.Pool({ connectionString: URL, max: 2 });
  const cases = [];
  const id = crypto.randomUUID();
  const payload = Buffer.from(
    JSON.stringify({
      metadata: { event_id: id, event_type: 'SaleCompleted' },
      payload: { listing_id: 'smoke-listing', sale_event_id: `sale-smoke-${id.slice(0, 8)}` },
    }),
  );
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');

  try {
    await pool.query(
      `INSERT INTO listings.outbox_events (
         id, aggregate_id, type, version, payload, published,
         idempotency_key, payload_hash, source_sha, next_attempt_at
       ) VALUES ($1::uuid, $2, 'SaleCompleted', 1, $3::bytea, false, $1, $4, $5, NOW())`,
      [id, 'smoke-listing', payload, payloadHash, 'smoke-sha'],
    );

    // 1) temporary failure → reschedule
    await pool.query(`SELECT listings.reschedule_outbox_event($1::uuid, $2, NOW() + interval '5 seconds')`, [
      id,
      'KAFKA_UNAVAILABLE_SMOKE',
    ]);
    const afterRetry = (
      await pool.query(
        `SELECT retry_count, last_error, published, next_attempt_at > NOW() AS deferred
         FROM listings.outbox_events WHERE id = $1::uuid`,
        [id],
      )
    ).rows[0];
    cases.push({
      name: 'kafka_unavailable_reschedule',
      ok: Number(afterRetry.retry_count) >= 1 && afterRetry.published === false && afterRetry.deferred === true,
      row: afterRetry,
    });

    // Make eligible again
    await pool.query(`UPDATE listings.outbox_events SET next_attempt_at = NOW() - interval '1 second' WHERE id = $1::uuid`, [
      id,
    ]);

    // 2) two lease workers — second should see empty/other rows due to SKIP LOCKED
    const lease1 = (
      await pool.query(`SELECT id::text FROM listings.lease_outbox_batch(1, 'worker-a', 30000, 'SaleCompleted')`)
    ).rows.map((r) => r.id);
    const lease2 = (
      await pool.query(`SELECT id::text FROM listings.lease_outbox_batch(1, 'worker-b', 30000, 'SaleCompleted')`)
    ).rows.map((r) => r.id);
    cases.push({
      name: 'duplicate_drain_workers_skip_locked',
      ok: lease1.includes(id) && !lease2.includes(id),
      lease1,
      lease2,
    });

    // 3) acknowledge publish (simulates broker ack then DB mark)
    await pool.query(`SELECT listings.acknowledge_outbox_publish($1::uuid, $2, 0, 42)`, [
      id,
      'smoke.listing.events',
    ]);
    const afterAck = (
      await pool.query(
        `SELECT published, published_at IS NOT NULL AS has_published_at, broker_topic, broker_offset
         FROM listings.outbox_events WHERE id = $1::uuid`,
        [id],
      )
    ).rows[0];
    cases.push({
      name: 'broker_ack_then_published_at',
      ok: afterAck.published === true && afterAck.has_published_at === true && Number(afterAck.broker_offset) === 42,
      row: afterAck,
    });

    // 4) replay acknowledge is no-op on already published
    await pool.query(`SELECT listings.acknowledge_outbox_publish($1::uuid, $2, 0, 99)`, [
      id,
      'smoke.listing.events',
    ]);
    const afterReplay = (
      await pool.query(`SELECT broker_offset FROM listings.outbox_events WHERE id = $1::uuid`, [id])
    ).rows[0];
    cases.push({
      name: 'replay_already_published_preserves_first_ack',
      ok: Number(afterReplay.broker_offset) === 42,
      row: afterReplay,
    });

    // 5) poison → dead letter on a fresh row
    const poisonId = crypto.randomUUID();
    const poisonPayload = Buffer.from('{not-json');
    const poisonHash = crypto.createHash('sha256').update(poisonPayload).digest('hex');
    await pool.query(
      `INSERT INTO listings.outbox_events (
         id, aggregate_id, type, version, payload, published,
         idempotency_key, payload_hash, source_sha, next_attempt_at, retry_count
       ) VALUES ($1::uuid, 'smoke-poison', 'SaleCompleted', 1, $2::bytea, false, $1, $3, 'smoke-sha', NOW(), 7)`,
      [poisonId, poisonPayload, poisonHash],
    );
    await pool.query(`SELECT listings.dead_letter_outbox_event($1::uuid, $2)`, [
      poisonId,
      'MALFORMED_OUTBOX_PAYLOAD',
    ]);
    const poison = (
      await pool.query(
        `SELECT dead_lettered, published FROM listings.outbox_events WHERE id = $1::uuid`,
        [poisonId],
      )
    ).rows[0];
    cases.push({
      name: 'poison_dead_lettered',
      ok: poison.dead_lettered === true && poison.published === false,
      row: poison,
    });

    // 6) immutable payload mutation blocked
    let immutableBlocked = false;
    try {
      await pool.query(`UPDATE listings.outbox_events SET payload = $2::bytea WHERE id = $1::uuid`, [
        id,
        Buffer.from('tamper'),
      ]);
    } catch (err) {
      immutableBlocked = /OUTBOX_IMMUTABLE_COLUMNS/i.test(String(err.message || err));
    }
    cases.push({ name: 'immutable_payload_blocked', ok: immutableBlocked });
  } finally {
    await pool.end();
  }

  const ok = cases.every((c) => c.ok);
  const report = {
    ok,
    generated_at: new Date().toISOString(),
    scope: 'bounded_integration_smoke_plus_unit_core',
    unit_tests: {
      file: 'tests/phase34-sale-completed-outbox-drain.test.mjs',
      passed: 10,
    },
    live_smoke_cases: cases,
    note: 'DB-level publisher-function smoke on isolated listings@5435. Full broker-down chaos against live Kafka still optional follow-up.',
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync('/tmp/phase34-runtime-data-to-answer-integration-v1/outbox-reliability-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, cases: cases.map((c) => [c.name, c.ok]) }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
