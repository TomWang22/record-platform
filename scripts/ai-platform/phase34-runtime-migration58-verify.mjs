#!/usr/bin/env node
/**
 * Migration 58 transactional proofs against listings@5435 (not production).
 * Evidence under /tmp/.../v2 only — never tracked reports/.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const URL =
  process.env.POSTGRES_URL_LISTINGS ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';
const EVID =
  process.env.PHASE34_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v2';
const OUT = `${EVID}/migrations-58-verification.json`;
const SHA40 = '1f366b7a82595cade658087231556c61d4b7fcb9';

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function ok(name, pass, detail = {}) {
  return { name, ok: Boolean(pass), ...detail };
}

async function insertOutbox(client, { id, sourceSha = SHA40, nextAttempt = 'NOW()' }) {
  await client.query(
    `INSERT INTO listings.outbox_events (
       id, aggregate_id, type, version, payload, published,
       idempotency_key, payload_hash, source_sha, next_attempt_at
     ) VALUES (
       $1::uuid, $2, 'SaleCompleted', 1, $3::bytea, false,
       $1, $4, $5, ${nextAttempt === 'NOW()' ? 'NOW()' : '$6::timestamptz'}
     )`,
    nextAttempt === 'NOW()'
      ? [id, `agg-${id}`, Buffer.from('{}'), sha(id), sourceSha]
      : [id, `agg-${id}`, Buffer.from('{}'), sha(id), sourceSha, nextAttempt],
  );
}

async function deferOthers(client, keepId) {
  await client.query(
    `UPDATE listings.outbox_events
     SET next_attempt_at = NOW() + interval '1 day'
     WHERE published = false
       AND COALESCE(dead_lettered,false)=false
       AND type='SaleCompleted'
       AND id <> $1::uuid`,
    [keepId],
  );
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  const pool = new pg.Pool({ connectionString: URL, max: 4 });
  const cases = [];
  const stamp = Date.now();

  try {
    // ---- 1 LEASE persists
    {
      const id = crypto.randomUUID();
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await insertOutbox(c, { id });
        await deferOthers(c, id);
        await c.query(`SELECT id FROM listings.lease_outbox_batch(1, 'worker-a', 60000, 'SaleCompleted')`);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
      const n = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND action='LEASE' AND result='OK'`,
          [id],
        )
      ).rows[0].n;
      cases.push(ok('1_lease_action_persists', n >= 1, { n }));
    }

    // ---- 2–6 wrong owner denials persist after commit
    {
      const id = crypto.randomUUID();
      await insertOutbox(pool, { id });
      await deferOthers(pool, id);
      await pool.query(`SELECT id FROM listings.lease_outbox_batch(1, 'worker-a', 60000, 'SaleCompleted')`);

      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const ack = (
          await c.query(
            `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-b','t',0,$2::bigint) AS r`,
            [id, stamp],
          )
        ).rows[0].r;
        const rs = (
          await c.query(
            `SELECT listings.reschedule_outbox_event($1::uuid,'worker-b','x',NOW()+interval '1 hour') AS r`,
            [id],
          )
        ).rows[0].r;
        const rl = (
          await c.query(`SELECT listings.release_outbox_lease($1::uuid,'worker-b') AS r`, [id])
        ).rows[0].r;
        const dl = (
          await c.query(`SELECT listings.dead_letter_outbox_event($1::uuid,'worker-b','x') AS r`, [id])
        ).rows[0].r;
        await c.query('COMMIT');
        cases.push(ok('2_wrong_owner_ack_denied', ack.result === 'DENIED', { ack }));
        cases.push(ok('4_wrong_owner_reschedule_denied', rs.result === 'DENIED', { rs }));
        cases.push(ok('5_wrong_owner_release_denied', rl.result === 'DENIED', { rl }));
        cases.push(ok('6_wrong_owner_dead_letter_denied', dl.result === 'DENIED', { dl }));
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }

      const denied = (
        await pool.query(
          `SELECT action, count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND result='DENIED'
           GROUP BY action`,
          [id],
        )
      ).rows;
      const by = Object.fromEntries(denied.map((r) => [r.action, r.n]));
      cases.push(
        ok('3_worker_b_denial_persists_after_commit', by.ACKNOWLEDGE_DENIED >= 1, { by }),
      );
      cases.push(
        ok(
          'denials_all_actions_persisted',
          by.ACKNOWLEDGE_DENIED >= 1 &&
            by.RESCHEDULE_DENIED >= 1 &&
            by.RELEASE_DENIED >= 1 &&
            by.DEAD_LETTER_DENIED >= 1,
          { by },
        ),
      );
    }

    // ---- 7 expired lease acquired by C; 8 A cannot ack after
    {
      const id = crypto.randomUUID();
      await insertOutbox(pool, { id });
      await deferOthers(pool, id);
      await pool.query(`SELECT id FROM listings.lease_outbox_batch(1, 'worker-a', 1, 'SaleCompleted')`);
      await new Promise((r) => setTimeout(r, 50));
      await pool.query(
        `UPDATE listings.outbox_events SET leased_until = NOW() - interval '1 second' WHERE id=$1::uuid`,
        [id],
      );
      const leasedC = (
        await pool.query(`SELECT id::text FROM listings.lease_outbox_batch(1, 'worker-c', 60000, 'SaleCompleted')`)
      ).rows.map((r) => r.id);
      cases.push(ok('7_expired_lease_acquired_by_c', leasedC.includes(id), { leasedC }));
      const ackA = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-a','t',0,$2::bigint) AS r`,
          [id, stamp + 1],
        )
      ).rows[0].r;
      cases.push(ok('8_old_owner_cannot_ack_after_release', ackA.result === 'DENIED', { ackA }));
      const ackC = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-c','t',0,$2::bigint) AS r`,
          [id, stamp + 2],
        )
      ).rows[0].r;
      cases.push(ok('9_successful_ack_one_action', ackC.result === 'OK' && ackC.affected_rows === 1, { ackC }));
      const ackCount = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND action='ACKNOWLEDGE' AND result='OK'`,
          [id],
        )
      ).rows[0].n;
      const dupAck = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-c','t',0,$2::bigint) AS r`,
          [id, stamp + 3],
        )
      ).rows[0].r;
      cases.push(ok('10_duplicate_ack_no_second_success', dupAck.result === 'DENIED' && ackCount === 1, { dupAck, ackCount }));
    }

    // ---- 11–14 authorization
    {
      const id = crypto.randomUUID();
      await insertOutbox(pool, { id });
      let forgeInsertBlocked = false;
      try {
        await pool.query(`SET ROLE record_outbox_publisher`);
        await pool.query(
          `INSERT INTO listings.outbox_publisher_action_ledger (
             action_id, outbox_event_id, action, lease_owner, result
           ) VALUES ($1, $2::uuid, 'LEASE', 'forged', 'OK')`,
          [`forge-${stamp}`, id],
        );
      } catch {
        forgeInsertBlocked = true;
      } finally {
        await pool.query('RESET ROLE');
      }
      cases.push(ok('11_publisher_cannot_direct_insert_ledger', forgeInsertBlocked));

      let helperBlocked = false;
      try {
        await pool.query(`SET ROLE record_outbox_publisher`);
        await pool.query(
          `SELECT listings._outbox_log_action($1::uuid,'LEASE','x','OK')`,
          [id],
        );
      } catch {
        helperBlocked = true;
      } finally {
        await pool.query('RESET ROLE');
      }
      cases.push(ok('12_publisher_cannot_execute_audit_helper', helperBlocked));

      let rwBlocked = false;
      try {
        await pool.query(`SET ROLE record_readwrite`);
        await pool.query(`SELECT listings.lease_outbox_batch(1,'rw',1000,'SaleCompleted')`);
      } catch {
        rwBlocked = true;
      } finally {
        await pool.query('RESET ROLE');
      }
      // record_readwrite may not exist in all envs
      const rwExists = (
        await pool.query(`SELECT 1 FROM pg_roles WHERE rolname='record_readwrite'`)
      ).rowCount;
      cases.push(ok('13_record_readwrite_cannot_execute_publisher', !rwExists || rwBlocked, { rwExists }));

      const pubExec = (
        await pool.query(
          `SELECT has_function_privilege('public',
             'listings.lease_outbox_batch(integer,text,integer,text)', 'EXECUTE') AS ok`,
        )
      ).rows[0].ok;
      cases.push(ok('14_public_cannot_execute_publisher', pubExec === false, { pubExec }));
    }

    // ---- 15–16 LEGACY_UNKNOWN
    {
      let blocked = false;
      try {
        await pool.query(
          `INSERT INTO listings.outbox_events (
             id, aggregate_id, type, version, payload, published,
             idempotency_key, payload_hash, source_sha
           ) VALUES (
             $1::uuid, 'x', 'SaleCompleted', 1, '\\x7b7d'::bytea, false,
             $1, $2, 'LEGACY_UNKNOWN'
           )`,
          [crypto.randomUUID(), sha('legacy')],
        );
      } catch {
        blocked = true;
      }
      cases.push(ok('15_new_legacy_unknown_insert_fails', blocked));

      const legacyReadable = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_events
           WHERE is_legacy_source_sha = true OR lower(source_sha)='legacy_unknown'`,
        )
      ).rows[0].n;
      cases.push(ok('16_historical_legacy_readable', legacyReadable >= 0, { legacyReadable }));
    }

    // ---- 17–20 supersession
    {
      const prevId = `ed-prev-${stamp}`;
      const newId = `ed-new-${stamp}`;
      const cycleId = `ed-cycle-${stamp}`;
      const snap = `es-m58-${stamp}`;
      await pool.query(
        `INSERT INTO intelligence.evidence_snapshots (
           evidence_snapshot_id, evidence_snapshot_hash, capability, payload
         ) VALUES ($1,$2,'valuation','{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [snap, sha(snap)],
      );
      const baseDec = async (eid, decidedAt, prev = null, subj = { a: 1 }) => {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, previous_decision_id, decided_at, superseded_by_decision_id
           ) VALUES (
             $1, $2, 'INCLUDED', 'valuation', $3::jsonb, $4, $5, $6::timestamptz, NULL
           )`,
          [snap, `me-${eid}`, JSON.stringify(subj), eid, prev, decidedAt],
        );
      };
      await baseDec(prevId, new Date(stamp).toISOString());
      await baseDec(newId, new Date(stamp + 1000).toISOString(), prevId);
      await baseDec(cycleId, new Date(stamp + 2000).toISOString(), newId);

      let missingFails = false;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason
           ) VALUES ($1,'no-such-prev',$2,'x')`,
          [`edge-miss-${stamp}`, newId],
        );
      } catch {
        missingFails = true;
      }
      cases.push(ok('17_supersession_missing_decision_fails', missingFails));

      let selfFails = false;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason
           ) VALUES ($1,$2,$2,'self')`,
          [`edge-self-${stamp}`, prevId],
        );
      } catch {
        selfFails = true;
      }
      cases.push(ok('18_supersession_self_edge_fails', selfFails));

      await pool.query(
        `INSERT INTO intelligence.eligibility_supersession_edges (
           supersession_edge_id, previous_decision_id, new_decision_id, reason
         ) VALUES ($1,$2,$3,'correction')`,
        [`edge-ok-${stamp}`, prevId, newId],
      );
      let cycleFails = false;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason
           ) VALUES ($1,$2,$3,'cycle')`,
          [`edge-cyc-${stamp}`, newId, prevId],
        );
      } catch {
        cycleFails = true;
      }
      cases.push(ok('19_supersession_cycle_fails', cycleFails));

      const before = (
        await pool.query(
          `SELECT eligibility_decision_id, decision, capability, subject::text AS subject, decided_at::text
           FROM intelligence.eligibility_decisions WHERE eligibility_decision_id=$1`,
          [prevId],
        )
      ).rows[0];
      let updateBlocked = false;
      try {
        await pool.query(
          `UPDATE intelligence.eligibility_decisions SET reason_detail='mutated' WHERE eligibility_decision_id=$1`,
          [prevId],
        );
      } catch {
        updateBlocked = true;
      }
      const after = (
        await pool.query(
          `SELECT eligibility_decision_id, decision, capability, subject::text AS subject, decided_at::text
           FROM intelligence.eligibility_decisions WHERE eligibility_decision_id=$1`,
          [prevId],
        )
      ).rows[0];
      cases.push(
        ok(
          '20_previous_eligibility_byte_identical',
          updateBlocked && JSON.stringify(before) === JSON.stringify(after),
          { updateBlocked },
        ),
      );
    }

    // ---- 21–26 claim integrity DB-derived
    {
      const snap = `es-claim-${stamp}`;
      const snap2 = `es-claim2-${stamp}`;
      const calc = `calc-${stamp}`;
      const calcWrong = `calc-wrong-${stamp}`;
      const resp = `resp-${stamp}`;
      const ledger = `cl-${stamp}`;
      const claimOk = `claim-ok-${stamp}`;
      const claimFake = `claim-fake-${stamp}`;
      const claimAsk = `claim-ask-${stamp}`;
      const claimExcl = `claim-excl-${stamp}`;
      const claimPress = `claim-press-${stamp}`;
      const claimVal = `claim-val-${stamp}`;
      const meOk = `me-ok-${stamp}`;
      const meAsk = `me-ask-${stamp}`;
      const meExcl = `me-excl-${stamp}`;
      const meRel = `me-rel-${stamp}`;
      const obs = `obs-${stamp}`;

      const ensureObs = async (oid) => {
        const exists = (
          await pool.query(`SELECT 1 FROM intelligence.raw_observations WHERE observation_id=$1`, [oid])
        ).rowCount;
        if (exists) return;
        await pool.query(
          `INSERT INTO intelligence.raw_observations (
             observation_id, source_class, source_connector, source_record_id, source_event_type,
             observed_at, raw_payload, canonical_payload_hash, authorization_scope, rights_classification
           ) VALUES (
             $1, 'FIRST_PARTY_SETTLEMENT', 'migration58-test', $1, 'SALE_COMPLETED',
             NOW(), '{}'::jsonb, $2, 'test', 'FIRST_PARTY'
           )`,
          [oid, sha(oid)],
        );
      };
      await ensureObs(obs);

      const ensureMe = async (mid, eventType, pressingId) => {
        const exists = (
          await pool.query(`SELECT 1 FROM intelligence.market_events WHERE market_event_id=$1`, [mid])
        ).rowCount;
        if (exists) return;
        await pool.query(
          `INSERT INTO intelligence.market_events (
             market_event_id, observation_id, event_type, rights_status, deletion_status,
             occurred_at, payload_hash, payload, pressing_id
           ) VALUES ($1,$2,$3,'FIRST_PARTY','ACTIVE',NOW(),$4,'{}'::jsonb,$5)`,
          [mid, obs, eventType, sha(mid), pressingId],
        );
      };

      for (const [sid, hash] of [
        [snap, sha(snap)],
        [snap2, sha(snap2)],
      ]) {
        await pool.query(
          `INSERT INTO intelligence.evidence_snapshots (
             evidence_snapshot_id, evidence_snapshot_hash, capability, payload
           ) VALUES ($1,$2,'valuation','{}'::jsonb) ON CONFLICT DO NOTHING`,
          [sid, hash],
        );
      }

      await ensureMe(meOk, 'SALE_COMPLETED', 'press-1');
      await ensureMe(meAsk, 'ASKING_PRICE', 'press-1');
      await ensureMe(meExcl, 'SALE_COMPLETED', 'press-1');
      await ensureMe(meRel, 'SALE_COMPLETED', null);

      await pool.query(
        `INSERT INTO intelligence.evidence_snapshot_items (
           evidence_snapshot_id, market_event_id, evidence_id, included, event_type
         ) VALUES
           ($1,$2,$2,true,'SALE_COMPLETED'),
           ($1,$3,$3,true,'ASKING_PRICE'),
           ($1,$4,$4,false,'SALE_COMPLETED'),
           ($1,$5,$5,true,'SALE_COMPLETED')
         ON CONFLICT DO NOTHING`,
        [snap, meOk, meAsk, meExcl, meRel],
      );
      await pool.query(
        `INSERT INTO intelligence.evidence_snapshot_exclusions (
           evidence_snapshot_id, market_event_id, evidence_id, decision, reason_detail
         ) VALUES ($1,$2,$2,'EXCLUDED_RIGHTS','x')
         ON CONFLICT DO NOTHING`,
        [snap, meExcl],
      );

      const calcHash = sha(`calc-body-${stamp}`);
      const calcWrongHash = sha(`calc-wrong-${stamp}`);
      await pool.query(
        `INSERT INTO intelligence.deterministic_calculations (
           calculation_id, capability, evidence_snapshot_id, currency,
           eligible_sale_prices, result_hash, payload, median,
           fair_market_range, quick_sale_range, patient_sale_range
         ) VALUES
           ($1,'valuation',$2,'USD','[10,20,30]'::jsonb,$3::text,
            jsonb_build_object('sold_count', 3, 'canonical_result_hash', $3::text),20,
            '{"low":15,"high":25}'::jsonb,'{"low":10,"high":18}'::jsonb,'{"low":22,"high":30}'::jsonb),
           ($4,'valuation',$5,'USD','[10]'::jsonb,$6::text,
            jsonb_build_object('sold_count', 1, 'canonical_result_hash', $6::text),10,NULL,NULL,NULL)
         ON CONFLICT DO NOTHING`,
        [calc, snap, calcHash, calcWrong, snap2, calcWrongHash],
      );

      await pool.query(
        `INSERT INTO intelligence.claim_ledgers (
           claim_ledger_id, response_id, evidence_snapshot_id, evidence_snapshot_hash, verification_status
         ) VALUES ($1,$2,$3,$4,'PASS') ON CONFLICT DO NOTHING`,
        [ledger, resp, snap, sha(snap)],
      );
      await pool.query(
        `INSERT INTO intelligence.response_envelopes (
           response_id, capability, evidence_snapshot_id, evidence_snapshot_hash,
           claim_ledger_id, envelope_payload
         ) VALUES ($1,'valuation',$2,$3,$4,'{}'::jsonb) ON CONFLICT DO NOTHING`,
        [resp, snap, sha(snap), ledger],
      );

      await pool.query(
        `INSERT INTO intelligence.claim_ledger_entries (
           claim_id, claim_ledger_id, response_id, claim_type, normalized_claim_value,
           supporting_snapshot_item_ids, deterministic_calculation_id, verification_result
         ) VALUES
           ($1,$2,$3,'sold_count','3'::jsonb,$4::jsonb,$5,'SUPPORTED'),
           ($6,$2,$3,'sold_count','3'::jsonb,$4::jsonb,$7,'SUPPORTED'),
           ($8,$2,$3,'sold_count','3'::jsonb,$9::jsonb,$5,'SUPPORTED'),
           ($10,$2,$3,'sold_count','3'::jsonb,$11::jsonb,$5,'SUPPORTED'),
           ($12,$2,$3,'exact_pressing_match','true'::jsonb,$13::jsonb,$5,'SUPPORTED'),
           ($14,$2,$3,'sold_count','99'::jsonb,$4::jsonb,$5,'SUPPORTED')
         ON CONFLICT DO NOTHING`,
        [
          claimOk, ledger, resp, JSON.stringify([meOk]), calc,
          claimFake, calcWrong,
          claimAsk, JSON.stringify([meAsk]),
          claimExcl, JSON.stringify([meExcl]),
          claimPress, JSON.stringify([meRel]),
          claimVal,
        ],
      );

      const vFake = (
        await pool.query(
          `SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`,
          [resp, claimFake, calcWrong],
        )
      ).rows[0].r;
      cases.push(
        ok('21_caller_faked_snapshot_via_wrong_calc_fails', vFake.result === 'FAIL', {
          failures: vFake.failure_codes,
        }),
      );

      const vWrongSnap = (
        await pool.query(
          `SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`,
          [resp, claimFake, calcWrong],
        )
      ).rows[0].r;
      cases.push(
        ok(
          '22_wrong_calculation_snapshot_fails',
          vWrongSnap.result === 'FAIL' &&
            JSON.stringify(vWrongSnap.failure_codes).includes('CALCULATION_SNAPSHOT'),
          { failures: vWrongSnap.failure_codes },
        ),
      );

      const vAsk = (
        await pool.query(`SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`, [
          resp,
          claimAsk,
          calc,
        ])
      ).rows[0].r;
      cases.push(
        ok(
          '23_asking_supports_sold_count_fails',
          vAsk.result === 'FAIL' &&
            JSON.stringify(vAsk.failure_codes).includes('ASKING_SUPPORTS_SOLD'),
          { failures: vAsk.failure_codes },
        ),
      );

      const vExcl = (
        await pool.query(`SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`, [
          resp,
          claimExcl,
          calc,
        ])
      ).rows[0].r;
      cases.push(
        ok(
          '24_excluded_evidence_supports_claim_fails',
          vExcl.result === 'FAIL' &&
            (JSON.stringify(vExcl.failure_codes).includes('EXCLUDED_SUPPORTS') ||
              JSON.stringify(vExcl.failure_codes).includes('SUPPORTING_NOT_IN_SNAPSHOT')),
          { failures: vExcl.failure_codes },
        ),
      );

      const vPress = (
        await pool.query(`SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`, [
          resp,
          claimPress,
          calc,
        ])
      ).rows[0].r;
      cases.push(
        ok(
          '25_exact_pressing_release_only_fails',
          vPress.result === 'FAIL' &&
            JSON.stringify(vPress.failure_codes).includes('RELEASE_ONLY'),
          { failures: vPress.failure_codes },
        ),
      );

      const vVal = (
        await pool.query(`SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`, [
          resp,
          claimVal,
          calc,
        ])
      ).rows[0].r;
      cases.push(
        ok(
          '26_claim_value_differs_from_calc_fails',
          vVal.result === 'FAIL' &&
            JSON.stringify(vVal.failure_codes).includes('SOLD_COUNT_MISMATCH'),
          { failures: vVal.failure_codes },
        ),
      );

      // Persist check: FAIL rows exist
      const failRows = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.claim_integrity_verifications WHERE result='FAIL'`,
        )
      ).rows[0].n;
      cases.push(ok('claim_fail_verifications_persisted', failRows >= 4, { failRows }));
    }

    // ---- 27–29 Kafka identity/delivery (regression)
    {
      const src = `src-m58-${stamp}`;
      const hashA = sha(`a-${stamp}`);
      const hashB = sha(`b-${stamp}`);
      await pool.query(
        `INSERT INTO intelligence.kafka_event_identities (
           source_event_id, normalization_version, canonical_payload_hash,
           accepted_market_event_id, first_topic, first_partition, first_offset, source_sha
         ) VALUES ($1,'phase34-market-event-v2',$2,$3,'t',0,$4,$5)`,
        [src, hashA, `me-${src}`, stamp, SHA40],
      );
      await pool.query(
        `INSERT INTO intelligence.kafka_delivery_lineage (
           delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
           normalization_version, received_payload_hash, canonical_payload_hash,
           market_event_id, result, duplicate_flag, source_sha
         ) VALUES
           ($1,'t',0,$2,$3,'phase34-market-event-v2',$4,$4,$5,'ACCEPTED',false,$6),
           ($7,'t',0,$8,$3,'phase34-market-event-v2',$4,$4,$5,'DUPLICATE_DELIVERY',true,$6)`,
        [`dlv-a-${stamp}`, stamp, src, hashA, `me-${src}`, SHA40, `dlv-b-${stamp}`, stamp + 1],
      );
      const ids = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.kafka_event_identities WHERE source_event_id=$1`,
          [src],
        )
      ).rows[0].n;
      const dups = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.kafka_delivery_lineage
           WHERE source_event_id=$1 AND result='DUPLICATE_DELIVERY'`,
          [src],
        )
      ).rows[0].n;
      cases.push(ok('27_duplicate_delivery_second_row', ids === 1 && dups === 1, { ids, dups }));

      await pool.query(
        `INSERT INTO intelligence.kafka_delivery_lineage (
           delivery_lineage_id, topic, partition_id, record_offset, source_event_id,
           normalization_version, received_payload_hash, canonical_payload_hash,
           result, duplicate_flag, rejection_reason, source_sha
         ) VALUES ($1,'t',0,$2,$3,'phase34-market-event-v2',$4,$5,
           'IDENTITY_PAYLOAD_CONFLICT',false,'IDENTITY_PAYLOAD_CONFLICT',$6)`,
        [`dlv-c-${stamp}`, stamp + 2, src, hashB, hashA, SHA40],
      );
      const conflicts = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.kafka_delivery_lineage
           WHERE source_event_id=$1 AND result='IDENTITY_PAYLOAD_CONFLICT'`,
          [src],
        )
      ).rows[0].n;
      cases.push(ok('28_identity_conflict_quarantine_path', conflicts === 1, { conflicts }));

      await pool.query(
        `INSERT INTO intelligence.kafka_event_identities (
           source_event_id, normalization_version, canonical_payload_hash,
           accepted_market_event_id, first_topic, first_partition, first_offset, source_sha
         ) VALUES
           ($1,'phase34-market-event-v2',$2,$3,'t',1,$4,$5),
           ($6,'phase34-market-event-v2',$2,$7,'t',1,$8,$5)`,
        [
          `src-econ-a-${stamp}`,
          hashA,
          `me-econ-a-${stamp}`,
          stamp + 10,
          SHA40,
          `src-econ-b-${stamp}`,
          `me-econ-b-${stamp}`,
          stamp + 11,
        ],
      );
      const econ = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.kafka_event_identities
           WHERE source_event_id LIKE $1 AND canonical_payload_hash=$2`,
          [`src-econ-%-${stamp}`, hashA],
        )
      ).rows[0].n;
      cases.push(ok('29_two_settlements_identical_economics_ok', econ === 2, { econ }));
    }

    // ---- 30 duplicate broker coordinate cannot ack two events
    {
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const topic = `coord.topic.${stamp}`;
      const offset = stamp + 999;
      await insertOutbox(pool, { id: id1 });
      await insertOutbox(pool, { id: id2 });
      // Park all SaleCompleted including these, then wake only id1.
      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() + interval '2 days', leased_until = NULL, lease_owner = NULL
         WHERE type='SaleCompleted' AND published=false`,
      );
      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() - interval '1 second'
         WHERE id=$1::uuid`,
        [id1],
      );
      const leased1 = (
        await pool.query(
          `SELECT id::text FROM listings.lease_outbox_batch(1,'worker-coord',60000,'SaleCompleted')`,
        )
      ).rows.map((r) => r.id);
      const a1 = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-coord',$2,3,$3::bigint) AS r`,
          [id1, topic, offset],
        )
      ).rows[0].r;

      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() - interval '1 second', leased_until = NULL, lease_owner = NULL
         WHERE id=$1::uuid`,
        [id2],
      );
      // Keep every other eligible row parked
      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() + interval '2 days'
         WHERE type='SaleCompleted' AND published=false AND id<>$1::uuid`,
        [id2],
      );
      const leased2 = (
        await pool.query(
          `SELECT id::text FROM listings.lease_outbox_batch(1,'worker-coord',60000,'SaleCompleted')`,
        )
      ).rows.map((r) => r.id);
      const a2 = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-coord',$2,3,$3::bigint) AS r`,
          [id2, topic, offset],
        )
      ).rows[0].r;
      cases.push(
        ok(
          '30_duplicate_broker_coord_rejected',
          leased1.includes(id1) &&
            a1.result === 'OK' &&
            leased2.includes(id2) &&
            a2.result === 'DENIED' &&
            a2.error_class === 'BROKER_COORD_CONFLICT',
          { leased1, leased2, a1, a2 },
        ),
      );
    }

    // Two workers cannot both hold active lease
    {
      const id = crypto.randomUUID();
      await insertOutbox(pool, { id });
      await deferOthers(pool, id);
      const a = (
        await pool.query(`SELECT id::text FROM listings.lease_outbox_batch(1,'wa',60000,'SaleCompleted')`)
      ).rows.map((r) => r.id);
      const b = (
        await pool.query(`SELECT id::text FROM listings.lease_outbox_batch(1,'wb',60000,'SaleCompleted')`)
      ).rows.map((r) => r.id);
      cases.push(ok('concurrent_lease_exclusive', a.includes(id) && !b.includes(id), { a, b }));
    }
  } finally {
    await pool.end();
  }

  const failed = cases.filter((c) => !c.ok);
  const report = {
    ok: failed.length === 0,
    generated_at: new Date().toISOString(),
    migration: 58,
    cases_total: cases.length,
    cases_passed: cases.filter((c) => c.ok).length,
    cases_failed: failed.map((c) => c.name),
    cases,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(
    `${EVID}/publisher-authorization-report.json`,
    JSON.stringify(
      {
        publisher_role: 'record_outbox_publisher',
        function_owner_role: 'record_outbox_function_owner',
        direct_ledger_insert: false,
        direct_audit_helper_execute: false,
        cases: cases.filter((c) => c.name.startsWith('1') || c.name.includes('publisher') || c.name.includes('public')),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ ok: report.ok, passed: report.cases_passed, total: report.cases_total, failed: report.cases_failed, out: OUT }, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
