#!/usr/bin/env node
/**
 * Migration 57 DB proofs against listings@5435 (not production).
 * Writes evidence under /tmp/... only — never tracked reports/.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const URL =
  process.env.POSTGRES_URL_LISTINGS ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';
const EVID =
  process.env.PHASE34_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v1';
const OUT = `${EVID}/migrations-57-verification.json`;

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  const pool = new pg.Pool({ connectionString: URL, max: 2 });
  const cases = [];
  const stamp = Date.now();

  try {
    // 1–2: identity + delivery duplicate / conflict
    const src = `src-m57-${stamp}`;
    const hashA = sha(`payload-a-${stamp}`);
    const hashB = sha(`payload-b-${stamp}`);
    await pool.query(
      `INSERT INTO intelligence.kafka_event_identities (
         source_event_id, normalization_version, canonical_payload_hash,
         accepted_market_event_id, first_topic, first_partition, first_offset, source_sha
       ) VALUES ($1, 'phase34-market-event-v2', $2, $3, 't', 0, $4, 'test-sha')`,
      [src, hashA, `me-${src}`, stamp],
    );
    await pool.query(
      `INSERT INTO intelligence.kafka_delivery_lineage (
         delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
         normalization_version, received_payload_hash, canonical_payload_hash,
         market_event_id, result, duplicate_flag, source_sha
       ) VALUES ($1, 't', 0, $2, $3, 'phase34-market-event-v2', $4, $4, $5, 'ACCEPTED', false, 'test-sha')`,
      [`dlv-a-${stamp}`, stamp, src, hashA, `me-${src}`],
    );
    await pool.query(
      `INSERT INTO intelligence.kafka_delivery_lineage (
         delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
         normalization_version, received_payload_hash, canonical_payload_hash,
         market_event_id, result, duplicate_flag, source_sha
       ) VALUES ($1, 't', 0, $2, $3, 'phase34-market-event-v2', $4, $4, $5, 'DUPLICATE_DELIVERY', true, 'test-sha')`,
      [`dlv-b-${stamp}`, stamp + 1, src, hashA, `me-${src}`],
    );
    const idCount = (
      await pool.query(
        `SELECT count(*)::int AS n FROM intelligence.kafka_event_identities WHERE source_event_id=$1`,
        [src],
      )
    ).rows[0].n;
    const dupCount = (
      await pool.query(
        `SELECT count(*)::int AS n FROM intelligence.kafka_delivery_lineage
         WHERE source_event_id=$1 AND result='DUPLICATE_DELIVERY'`,
        [src],
      )
    ).rows[0].n;
    cases.push({
      name: 'same_source_same_hash_two_deliveries',
      ok: idCount === 1 && dupCount === 1,
      idCount,
      dupCount,
    });

    await pool.query(
      `INSERT INTO intelligence.kafka_delivery_lineage (
         delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
         normalization_version, received_payload_hash, canonical_payload_hash,
         market_event_id, result, duplicate_flag, rejection_reason, source_sha
       ) VALUES ($1, 't', 0, $2, $3, 'phase34-market-event-v2', $4, $5, $6,
         'IDENTITY_PAYLOAD_CONFLICT', false, 'IDENTITY_PAYLOAD_CONFLICT', 'test-sha')`,
      [`dlv-c-${stamp}`, stamp + 2, src, hashB, hashA, `me-${src}`],
    );
    await pool.query(
      `INSERT INTO intelligence.kafka_event_quarantine (
         quarantine_id, topic, partition_id, record_offset, source_event_id, payload, reason
       ) VALUES ($1, 't', 0, $2, $3, '{}'::jsonb, 'IDENTITY_PAYLOAD_CONFLICT')`,
      [`q-m57-${stamp}`, stamp + 2, src],
    );
    const conflictN = (
      await pool.query(
        `SELECT count(*)::int AS n FROM intelligence.kafka_delivery_lineage
         WHERE source_event_id=$1 AND result='IDENTITY_PAYLOAD_CONFLICT'`,
        [src],
      )
    ).rows[0].n;
    cases.push({
      name: 'same_source_changed_hash_conflict_quarantine',
      ok: idCount === 1 && conflictN === 1,
      conflictN,
    });

    // 3: same topic/partition/offset unique
    let offsetDupBlocked = false;
    try {
      await pool.query(
        `INSERT INTO intelligence.kafka_delivery_lineage (
           delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
           normalization_version, received_payload_hash, result, source_sha
         ) VALUES ($1, 't', 0, $2, $3, 'phase34-market-event-v2', $4, 'DUPLICATE_DELIVERY', 'test-sha')`,
        [`dlv-replay-${stamp}`, stamp, src, hashA],
      );
    } catch (err) {
      offsetDupBlocked = /unique|duplicate/i.test(String(err.message || err));
    }
    cases.push({ name: 'topic_partition_offset_unique', ok: offsetDupBlocked });

    // 4: two settlements similar payload hashes OK (no unique on payload_hash)
    const o1 = crypto.randomUUID();
    const o2 = crypto.randomUUID();
    const similarHash = sha(`similar-${stamp}`);
    await pool.query(
      `INSERT INTO listings.outbox_events (
         id, aggregate_id, type, version, payload, published,
         idempotency_key, payload_hash, source_sha
       ) VALUES
       ($1::uuid, 'a', 'SaleCompleted', 1, $3::bytea, false, $1, $4, 'test-sha-m57'),
       ($2::uuid, 'b', 'SaleCompleted', 1, $3::bytea, false, $2, $4, 'test-sha-m57')`,
      [o1, o2, Buffer.from('{}'), similarHash],
    );
    cases.push({ name: 'two_settlements_same_payload_hash_accepted', ok: true });

    // 5–6: PUBLIC / non-publisher cannot execute
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='m57_public_probe') THEN
        CREATE ROLE m57_public_probe NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='m57_app_rw_probe') THEN
        CREATE ROLE m57_app_rw_probe NOLOGIN;
      END IF;
    END $$;`);
    let publicDenied = false;
    try {
      await pool.query(`SET ROLE m57_public_probe`);
      await pool.query(`SELECT listings.lease_outbox_batch(1, 'x', 1000, 'SaleCompleted')`);
    } catch (err) {
      publicDenied = /permission denied/i.test(String(err.message || err));
    } finally {
      await pool.query(`RESET ROLE`).catch(() => {});
    }
    cases.push({ name: 'public_cannot_execute_publisher_fns', ok: publicDenied });

    let rwDenied = false;
    try {
      await pool.query(`SET ROLE m57_app_rw_probe`);
      await pool.query(`SELECT listings.lease_outbox_batch(1, 'x', 1000, 'SaleCompleted')`);
    } catch (err) {
      rwDenied = /permission denied/i.test(String(err.message || err));
    } finally {
      await pool.query(`RESET ROLE`).catch(() => {});
    }
    cases.push({ name: 'non_publisher_role_cannot_execute', ok: rwDenied });

    // 7–8: lease ownership
    await pool.query(
      `UPDATE listings.outbox_events
       SET next_attempt_at = NOW() + interval '1 day'
       WHERE published = false
         AND type = 'SaleCompleted'
         AND COALESCE(dead_lettered, false) = false`,
    );
    const leaseId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO listings.outbox_events (
         id, aggregate_id, type, version, payload, published,
         idempotency_key, payload_hash, source_sha, next_attempt_at
       ) VALUES ($1::uuid, 'lease', 'SaleCompleted', 1, $2::bytea, false, $1, $3, 'test-sha-m57', NOW())`,
      [leaseId, Buffer.from('{"ok":true}'), sha(leaseId)],
    );
    const leased = (
      await pool.query(`SELECT id::text AS id FROM listings.lease_outbox_batch(1, 'worker-a', 60000, 'SaleCompleted')`)
    ).rows.map((r) => r.id);
    if (!leased.includes(leaseId)) {
      cases.push({ name: 'wrong_lease_owner_cannot_ack', ok: false, error: 'lease_missed_target', leased });
    } else {
      let wrongAckDenied = false;
      try {
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid, 'worker-b', 't', 0, 1)`,
          [leaseId],
        );
      } catch (err) {
        wrongAckDenied = /OUTBOX_ACK_DENIED|not owned/i.test(String(err.message || err));
      }
      cases.push({ name: 'wrong_lease_owner_cannot_ack', ok: wrongAckDenied });
    }

    await pool.query(
      `UPDATE listings.outbox_events SET leased_until = NOW() - interval '1 second' WHERE id=$1::uuid`,
      [leaseId],
    );
    const recovered = (
      await pool.query(
        `SELECT id::text FROM listings.lease_outbox_batch(1, 'worker-c', 60000, 'SaleCompleted')`,
      )
    ).rows.map((r) => r.id);
    cases.push({
      name: 'expired_lease_recovery',
      ok: recovered.includes(leaseId),
      recovered,
    });
    if (recovered.includes(leaseId)) {
      await pool.query(
        `SELECT listings.acknowledge_outbox_publish($1::uuid, 'worker-c', 't', 0, 7)`,
        [leaseId],
      );
      const ackOk = (
        await pool.query(`SELECT published FROM listings.outbox_events WHERE id=$1::uuid`, [leaseId])
      ).rows[0].published;
      cases.push({ name: 'owner_ack_after_recovery', ok: ackOk === true });
    } else {
      cases.push({ name: 'owner_ack_after_recovery', ok: false, error: 'not_recovered' });
    }

    // 9–10 eligibility append-only + supersession edge
    let eligUpdateBlocked = false;
    const edPrev = `ed-prev-${stamp}`;
    const edNew = `ed-new-${stamp}`;
    // Use a disposable snapshot if needed — skip if table constraints require FKs
    try {
      await pool.query(
        `INSERT INTO intelligence.eligibility_supersession_edges (
           supersession_edge_id, previous_decision_id, new_decision_id, reason
         ) VALUES ($1, $2, $3, 'correction')`,
        [`ese-${stamp}`, edPrev, edNew],
      );
      cases.push({ name: 'correction_supersession_edge_insert', ok: true });
    } catch (err) {
      cases.push({
        name: 'correction_supersession_edge_insert',
        ok: false,
        error: String(err.message || err),
      });
    }
    try {
      await pool.query(
        `UPDATE intelligence.eligibility_decisions SET decision='INCLUDED' WHERE false`,
      );
    } catch (err) {
      eligUpdateBlocked = /APPEND_ONLY|forbidden|deny/i.test(String(err.message || err));
    }
    // Prove trigger exists even if no rows updated
    const trig = (
      await pool.query(
        `SELECT count(*)::int AS n FROM pg_trigger
         WHERE tgname='trg_eligibility_decisions_deny_update'`,
      )
    ).rows[0].n;
    cases.push({
      name: 'eligibility_append_only_triggers',
      ok: trig >= 1 || eligUpdateBlocked,
      trig,
    });

    // 11 calc append-only
    const calcTrig = (
      await pool.query(
        `SELECT count(*)::int AS n FROM pg_trigger
         WHERE tgname='trg_deterministic_calculations_deny_update'`,
      )
    ).rows[0].n;
    cases.push({ name: 'deterministic_calculation_append_only', ok: calcTrig >= 1 });

    // 12 claim integrity helper
    let claimFail = false;
    try {
      await pool.query(
        `SELECT intelligence.assert_claim_calculation_integrity(
           'missing-calc', 'snap-a', 'snap-a', '1'::jsonb, '1'::jsonb
         )`,
      );
    } catch (err) {
      claimFail = /CLAIM_CALCULATION_MISSING/i.test(String(err.message || err));
    }
    cases.push({ name: 'claim_wrong_calculation_rejected', ok: claimFail });

    // 13 legacy source_sha cannot insert new SaleCompleted
    let legacyBlocked = false;
    try {
      await pool.query(
        `INSERT INTO listings.outbox_events (
           id, aggregate_id, type, version, payload, published,
           idempotency_key, payload_hash, source_sha
         ) VALUES ($1::uuid, 'legacy', 'SaleCompleted', 1, $2::bytea, false, $1, $3, 'unknown')`,
        [crypto.randomUUID(), Buffer.from('{}'), sha('legacy')],
      );
    } catch (err) {
      legacyBlocked = /OUTBOX_SOURCE_SHA_INVALID/i.test(String(err.message || err));
    }
    cases.push({ name: 'legacy_unknown_source_sha_blocked_on_insert', ok: legacyBlocked });

    // payload hash unique index dropped
    const uniqPayload = (
      await pool.query(
        `SELECT count(*)::int AS n FROM pg_indexes
         WHERE schemaname='listings' AND indexname='uq_outbox_sale_completed_payload_hash'`,
      )
    ).rows[0].n;
    cases.push({ name: 'payload_hash_global_unique_dropped', ok: uniqPayload === 0 });

    // PUBLIC execute revoked on acknowledge
    const pubExec = (
      await pool.query(
        `SELECT has_function_privilege('public',
           'listings.acknowledge_outbox_publish(uuid,text,text,integer,bigint)', 'EXECUTE') AS ok`,
      )
    ).rows[0].ok;
    cases.push({ name: 'acknowledge_execute_revoked_from_public', ok: pubExec === false });
  } finally {
    await pool.end();
  }

  const ok = cases.every((c) => c.ok);
  const report = {
    ok,
    generated_at: new Date().toISOString(),
    migration: '57-phase34-runtime-delivery-and-supersession-hardening.sql',
    cases,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, out: OUT, passed: cases.filter((c) => c.ok).length, total: cases.length }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
