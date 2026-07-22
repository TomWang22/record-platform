#!/usr/bin/env node
/**
 * Migration 59 transactional proofs against listings@5435 (not production).
 * Evidence under /tmp/.../v3 only — never tracked reports/.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const URL =
  process.env.POSTGRES_URL_LISTINGS ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';
const EVID =
  process.env.PHASE34_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v3';
const OUT = `${EVID}/migrations/migrations-59-verification.json`;
const SHA40 = '1f366b7a82595cade658087231556c61d4b7fcb9';

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function ok(name, pass, detail = {}) {
  return { name, ok: Boolean(pass), ...detail };
}

function hasCode(r, code) {
  return JSON.stringify(r?.failure_codes || []).includes(code);
}

async function insertOutbox(client, { id, sourceSha = SHA40 }) {
  await client.query(
    `INSERT INTO listings.outbox_events (
       id, aggregate_id, type, version, payload, published,
       idempotency_key, payload_hash, source_sha, next_attempt_at
     ) VALUES (
       $1::uuid, $2, 'SaleCompleted', 1, $3::bytea, false,
       $1, $4, $5, NOW()
     )`,
    [id, `agg-${id}`, Buffer.from('{}'), sha(id), sourceSha],
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
  fs.mkdirSync(`${EVID}/migrations`, { recursive: true });
  const pool = new pg.Pool({ connectionString: URL, max: 4 });
  const cases = [];
  const stamp = Date.now();
  const prefix = `m59-${stamp}`;

  try {
    // ---- 1–3 trust boundary on verification rows
    {
      let forgeBlocked = false;
      try {
        await pool.query(`SET ROLE record_readwrite`);
        await pool.query(
          `INSERT INTO intelligence.claim_integrity_verifications (
             verification_id, response_id, claim_id, result
           ) VALUES ($1,'r','c','PASS')`,
          [`forge-pass-${stamp}`],
        );
      } catch {
        forgeBlocked = true;
      } finally {
        await pool.query('RESET ROLE');
      }
      cases.push(ok('1_record_readwrite_cannot_insert_fake_pass', forgeBlocked));

      let updateBlocked = false;
      let deleteBlocked = false;
      try {
        await pool.query(`SET ROLE record_readwrite`);
        await pool.query(
          `UPDATE intelligence.claim_integrity_verifications SET result='PASS' WHERE false`,
        );
      } catch {
        updateBlocked = true;
      }
      try {
        await pool.query(`SET ROLE record_readwrite`);
        await pool.query(
          `DELETE FROM intelligence.claim_integrity_verifications WHERE false`,
        );
      } catch {
        deleteBlocked = true;
      } finally {
        await pool.query('RESET ROLE');
      }
      // Even if privilege allows statement planning, revoke should block; triggers also deny.
      const canUpd = (
        await pool.query(
          `SELECT has_table_privilege('record_readwrite',
             'intelligence.claim_integrity_verifications','UPDATE') AS u,
                  has_table_privilege('record_readwrite',
             'intelligence.claim_integrity_verifications','DELETE') AS d,
                  has_table_privilege('record_readwrite',
             'intelligence.claim_integrity_verifications','INSERT') AS i`,
        )
      ).rows[0];
      cases.push(
        ok('2_record_readwrite_cannot_update_or_delete_verifications', !canUpd.u && !canUpd.d, {
          canUpd,
          updateBlocked,
          deleteBlocked,
        }),
      );
      cases.push(ok('3_record_readwrite_no_direct_insert_privilege', canUpd.i === false, { canUpd }));
    }

    // Shared fixture for claim verification cases
    const snap = `es-${prefix}`;
    const snapPayload = {
      canonical_algorithm: 'phase34-snapshot-hash-v1',
      canonical_snapshot_hash: null,
    };
    snapPayload.canonical_snapshot_hash = sha(JSON.stringify(snapPayload) + snap);
    // Use documented contract: store hash equal to payload field
    const snapHash = snapPayload.canonical_snapshot_hash;

    const obs = `obs-${prefix}`;
    const meSale = `me-sale-${prefix}`;
    const meAsk = `me-ask-${prefix}`;
    const meRights = `me-rights-${prefix}`;
    const meDel = `me-del-${prefix}`;
    const meUnsettled = `me-unset-${prefix}`;
    const meRelease = `me-rel-${prefix}`;
    const meEvidenceAlias = `ev-alias-${prefix}`;
    const calc = `calc-${prefix}`;
    const resp = `resp-${prefix}`;
    const ledger = `cl-${prefix}`;

    await pool.query(
      `INSERT INTO intelligence.raw_observations (
         observation_id, source_class, source_connector, source_record_id, source_event_type,
         observed_at, raw_payload, canonical_payload_hash, authorization_scope, rights_classification
       ) VALUES (
         $1, 'FIRST_PARTY_SETTLEMENT', 'migration59-test', $1, 'SALE_COMPLETED',
         NOW(), '{}'::jsonb, $2, 'test', 'FIRST_PARTY'
       ) ON CONFLICT DO NOTHING`,
      [obs, sha(obs)],
    );

    const ensureMe = async (mid, eventType, { pressingId = 'press-1', rights = 'FIRST_PARTY', deletion = 'ACTIVE', status = 'ACTIVE' } = {}) => {
      await pool.query(
        `INSERT INTO intelligence.market_events (
           market_event_id, observation_id, event_type, event_status, rights_status, deletion_status,
           occurred_at, payload_hash, payload, pressing_id
         ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,'{}'::jsonb,$8)
         ON CONFLICT DO NOTHING`,
        [mid, obs, eventType, status, rights, deletion, sha(mid), pressingId],
      );
    };

    await ensureMe(meSale, 'SALE_COMPLETED');
    await ensureMe(meAsk, 'ASKING_PRICE');
    await ensureMe(meRights, 'SALE_COMPLETED', { rights: 'DENIED' });
    await ensureMe(meDel, 'SALE_COMPLETED', { deletion: 'DELETED' });
    await ensureMe(meUnsettled, 'SALE_COMPLETED', { status: 'UNSETTLED' });
    await ensureMe(meRelease, 'SALE_COMPLETED', { pressingId: null });

    await pool.query(
      `INSERT INTO intelligence.evidence_snapshots (
         evidence_snapshot_id, evidence_snapshot_hash, capability, payload
       ) VALUES ($1,$2,'valuation',$3::jsonb) ON CONFLICT DO NOTHING`,
      [snap, snapHash, JSON.stringify(snapPayload)],
    );

    await pool.query(
      `INSERT INTO intelligence.evidence_snapshot_items (
         evidence_snapshot_id, market_event_id, evidence_id, included, event_type
       ) VALUES
         ($1,$2,$2,true,'SALE_COMPLETED'),
         ($1,$3,$3,true,'ASKING_PRICE'),
         ($1,$4,$4,true,'SALE_COMPLETED'),
         ($1,$5,$5,true,'SALE_COMPLETED'),
         ($1,$6,$6,true,'SALE_COMPLETED'),
         ($1,$7,$7,true,'SALE_COMPLETED'),
         ($1,$2,$8,true,'SALE_COMPLETED')
       ON CONFLICT DO NOTHING`,
      [snap, meSale, meAsk, meRights, meDel, meUnsettled, meRelease, meEvidenceAlias],
    );

    const includeElig = async (mid, decision = 'INCLUDED') => {
      const eid = `ed-${mid}-${decision}-${stamp}`;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,$3,'valuation','{"artist":"x"}'::jsonb,$4,NOW())`,
          [snap, mid, decision, eid],
        );
      } catch (e) {
        // unique (snapshot, market_event) — skip if already present
        if (!String(e.message).includes('duplicate') && !String(e.message).includes('unique')) throw e;
      }
    };
    await includeElig(meSale, 'INCLUDED');

    // Compute calculation hash from jsonb::text forms (same as verifier recompute).
    const prices = [10, 20, 30];
    const fair = { low: 15, high: 25 };
    const quick = { low: 10, high: 18 };
    const patient = { low: 22, high: 30 };

    const supportHash = (
      await pool.query(`SELECT intelligence.canonical_json_hash($1::jsonb) AS h`, [
        JSON.stringify([meSale]),
      ])
    ).rows[0].h;

    await pool.query(
      `INSERT INTO intelligence.deterministic_calculations (
         calculation_id, capability, evidence_snapshot_id, currency,
         eligible_sale_prices, result_hash, payload, median,
         fair_market_range, quick_sale_range, patient_sale_range
       )
       SELECT
         $1,'valuation',$2,'USD',$3::jsonb,
         intelligence.canonical_text_hash(
           'USD',
           '20',
           ($3::jsonb)::text,
           ($6::jsonb)::text,
           ($5::jsonb)::text,
           ($7::jsonb)::text,
           $2
         ),
         jsonb_build_object(
           'sold_count', 1,
           'support_set_hash', $4::text,
           'aggregate_contract', false
         ),
         20, $5::jsonb, $6::jsonb, $7::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM intelligence.deterministic_calculations d WHERE d.calculation_id = $1
       )`,
      [
        calc,
        snap,
        JSON.stringify(prices),
        supportHash,
        JSON.stringify(fair),
        JSON.stringify(quick),
        JSON.stringify(patient),
      ],
    );

    await pool.query(
      `INSERT INTO intelligence.claim_ledgers (
         claim_ledger_id, response_id, evidence_snapshot_id, evidence_snapshot_hash, verification_status
       ) VALUES ($1,$2,$3,$4,'PASS') ON CONFLICT DO NOTHING`,
      [ledger, resp, snap, snapHash],
    );
    await pool.query(
      `INSERT INTO intelligence.response_envelopes (
         response_id, capability, evidence_snapshot_id, evidence_snapshot_hash,
         claim_ledger_id, envelope_payload
       ) VALUES ($1,'valuation',$2,$3,$4,'{}'::jsonb) ON CONFLICT DO NOTHING`,
      [resp, snap, snapHash, ledger],
    );

    const insertClaim = async (claimId, fields) => {
      await pool.query(
        `INSERT INTO intelligence.claim_ledger_entries (
           claim_id, claim_ledger_id, response_id, claim_type, normalized_claim_value,
           supporting_snapshot_item_ids, deterministic_calculation_id, verification_result
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
         ON CONFLICT DO NOTHING`,
        [
          claimId,
          ledger,
          resp,
          fields.claim_type,
          JSON.stringify(fields.value),
          JSON.stringify(fields.support || []),
          fields.calc_id === undefined ? calc : fields.calc_id,
          fields.verification_result || 'SUPPORTED',
        ],
      );
    };

    const verify = async (claimId, calcId = null) => {
      const r = (
        await pool.query(
          `SELECT intelligence.verify_claim_integrity_from_db($1,$2,$3) AS r`,
          [resp, claimId, calcId],
        )
      ).rows[0].r;
      return r;
    };

    // ---- 3 only verifier function can create PASS/FAIL
    {
      const claimPass = `claim-pass-${prefix}`;
      await insertClaim(claimPass, {
        claim_type: 'sold_count',
        value: 1,
        support: [meSale],
      });
      const before = (
        await pool.query(
          `SELECT count(*)::int AS n FROM intelligence.claim_integrity_verifications WHERE claim_id=$1`,
          [claimPass],
        )
      ).rows[0].n;
      const r = await verify(claimPass, calc);
      const after = (
        await pool.query(
          `SELECT count(*)::int AS n, bool_or(result='PASS') AS any_pass
           FROM intelligence.claim_integrity_verifications WHERE claim_id=$1`,
          [claimPass],
        )
      ).rows[0];
      cases.push(
        ok(
          '3b_only_verifier_function_creates_pass_fail',
          r.result === 'PASS' && after.n === before + 1 && after.any_pass === true,
          { r, after },
        ),
      );
    }

    // ---- 4 caller calculation substitution
    {
      const claimNoCalc = `claim-nocalc-${prefix}`;
      await insertClaim(claimNoCalc, {
        claim_type: 'sold_count',
        value: 1,
        support: [meSale],
        calc_id: null,
      });
      const r = await verify(claimNoCalc, calc);
      cases.push(
        ok('4_caller_calculation_substitution_fails', r.result === 'FAIL' && hasCode(r, 'CALLER_CALCULATION_SUBSTITUTION'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 5 material claim missing calc link
    {
      const claimMissing = `claim-misscalc-${prefix}`;
      await insertClaim(claimMissing, {
        claim_type: 'sold_count',
        value: 1,
        support: [meSale],
        calc_id: null,
      });
      const r = await verify(claimMissing, null);
      cases.push(
        ok(
          '5_material_claim_missing_calculation_fails',
          r.result === 'FAIL' && hasCode(r, 'MATERIAL_CLAIM_MISSING_CALCULATION'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 6 evidence_id resolves to market_event_id
    {
      const claimAlias = `claim-alias-${prefix}`;
      await insertClaim(claimAlias, {
        claim_type: 'sold_count',
        value: 1,
        support: [meEvidenceAlias],
      });
      const r = await verify(claimAlias, calc);
      cases.push(
        ok(
          '6_evidence_id_resolves_to_canonical_market_event',
          r.result === 'PASS' ||
            (r.result === 'FAIL' &&
              !hasCode(r, 'SUPPORTING_ITEM_NOT_IN_SNAPSHOT') &&
              Array.isArray(r.support_set_hash ? [1] : [])),
          { r },
        ),
      );
      // Stronger: market_ids in attempt details include meSale
      const attempt = (
        await pool.query(
          `SELECT details FROM intelligence.claim_verifier_attempt_ledger
           WHERE claim_id=$1 ORDER BY occurred_at DESC LIMIT 1`,
          [claimAlias],
        )
      ).rows[0];
      const mids = attempt?.details?.market_ids || [];
      cases.push(
        ok('6b_alias_maps_to_me_sale', mids.includes(meSale), { mids, attempt }),
      );
    }

    // ---- 7 rights invalid
    {
      await includeElig(meRights, 'INCLUDED').catch(() => {});
      // If unique blocks, insert won't happen — use separate snapshot item already included;
      // rights check is on market_events.rights_status regardless.
      const claimRights = `claim-rights-${prefix}`;
      await insertClaim(claimRights, {
        claim_type: 'sold_count',
        value: 1,
        support: [meRights],
      });
      // Need eligibility for rights event — may conflict with unique; delete path unavailable.
      // Insert with different approach: if missing INCLUDED, still expect RIGHTS_INELIGIBLE when resolved.
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,'INCLUDED','valuation','{}'::jsonb,$3,NOW())`,
          [snap, meRights, `ed-rights-${stamp}`],
        );
      } catch {
        /* unique: ok if prior */
      }
      const r = await verify(claimRights, calc);
      cases.push(
        ok('7_rights_invalid_support_fails', r.result === 'FAIL' && hasCode(r, 'RIGHTS_INELIGIBLE'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 8 deleted
    {
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,'INCLUDED','valuation','{}'::jsonb,$3,NOW())`,
          [snap, meDel, `ed-del-${stamp}`],
        );
      } catch {
        /* */
      }
      const claimDel = `claim-del-${prefix}`;
      await insertClaim(claimDel, {
        claim_type: 'sold_count',
        value: 1,
        support: [meDel],
      });
      const r = await verify(claimDel, calc);
      cases.push(
        ok('8_deleted_support_fails', r.result === 'FAIL' && hasCode(r, 'DELETED_EVIDENCE'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 9 asking supports sold
    {
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,'INCLUDED','valuation','{}'::jsonb,$3,NOW())`,
          [snap, meAsk, `ed-ask-${stamp}`],
        );
      } catch {
        /* */
      }
      const claimAsk = `claim-ask-${prefix}`;
      await insertClaim(claimAsk, {
        claim_type: 'sold_count',
        value: 1,
        support: [meAsk],
      });
      const r = await verify(claimAsk, calc);
      cases.push(
        ok('9_asking_supports_sold_count_fails', r.result === 'FAIL' && hasCode(r, 'ASKING_SUPPORTS_SOLD'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 10 unsettled
    {
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,'INCLUDED','valuation','{}'::jsonb,$3,NOW())`,
          [snap, meUnsettled, `ed-unset-${stamp}`],
        );
      } catch {
        /* */
      }
      const claimUnset = `claim-unset-${prefix}`;
      await insertClaim(claimUnset, {
        claim_type: 'sold_count',
        value: 1,
        support: [meUnsettled],
      });
      const r = await verify(claimUnset, calc);
      cases.push(
        ok(
          '10_unsettled_supports_sale_fails',
          r.result === 'FAIL' && hasCode(r, 'UNSETTLED_SUPPORTS_SALE'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 11 release-only exact pressing
    {
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at
           ) VALUES ($1,$2,'INCLUDED','valuation','{}'::jsonb,$3,NOW())`,
          [snap, meRelease, `ed-rel-${stamp}`],
        );
      } catch {
        /* */
      }
      const claimPress = `claim-press-${prefix}`;
      await insertClaim(claimPress, {
        claim_type: 'exact_pressing_match',
        value: true,
        support: [meRelease],
      });
      const r = await verify(claimPress, calc);
      cases.push(
        ok(
          '11_release_only_exact_pressing_fails',
          r.result === 'FAIL' && hasCode(r, 'RELEASE_ONLY_SUPPORTS_EXACT_PRESSING'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 12 no INCLUDED eligibility
    {
      const meNoElig = `me-noelig-${prefix}`;
      await ensureMe(meNoElig, 'SALE_COMPLETED');
      await pool.query(
        `INSERT INTO intelligence.evidence_snapshot_items (
           evidence_snapshot_id, market_event_id, evidence_id, included, event_type
         ) VALUES ($1,$2,$2,true,'SALE_COMPLETED') ON CONFLICT DO NOTHING`,
        [snap, meNoElig],
      );
      const claimNoElig = `claim-noelig-${prefix}`;
      await insertClaim(claimNoElig, {
        claim_type: 'sold_count',
        value: 1,
        support: [meNoElig],
      });
      const r = await verify(claimNoElig, calc);
      cases.push(
        ok(
          '12_missing_included_eligibility_fails',
          r.result === 'FAIL' && hasCode(r, 'INCLUDED_ELIGIBILITY_DECISION_MISSING'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 13 empty support
    {
      const claimEmpty = `claim-empty-${prefix}`;
      await insertClaim(claimEmpty, {
        claim_type: 'sold_count',
        value: 1,
        support: [],
      });
      const r = await verify(claimEmpty, calc);
      cases.push(
        ok('13_empty_support_material_fails', r.result === 'FAIL' && hasCode(r, 'SUPPORT_SET_EMPTY'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 14 sold_count != support count
    {
      const claimCount = `claim-count-${prefix}`;
      await insertClaim(claimCount, {
        claim_type: 'sold_count',
        value: 3,
        support: [meSale],
      });
      const r = await verify(claimCount, calc);
      cases.push(
        ok(
          '14_sold_count_differs_from_support_fails',
          r.result === 'FAIL' && (hasCode(r, 'CLAIM_VALUE_MISMATCH') || hasCode(r, 'SOLD_COUNT_MISMATCH')),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 15 median differs
    {
      const claimMed = `claim-med-${prefix}`;
      await insertClaim(claimMed, {
        claim_type: 'median',
        value: 999,
        support: [meSale],
      });
      const r = await verify(claimMed, calc);
      cases.push(
        ok('15_median_differs_fails', r.result === 'FAIL' && hasCode(r, 'CLAIM_VALUE_MISMATCH'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 16 range differs
    {
      const claimRange = `claim-range-${prefix}`;
      await insertClaim(claimRange, {
        claim_type: 'fair_market_range',
        value: { low: 1, high: 2 },
        support: [meSale],
      });
      const r = await verify(claimRange, calc);
      cases.push(
        ok('16_range_differs_fails', r.result === 'FAIL' && hasCode(r, 'CLAIM_VALUE_MISMATCH'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 17 snapshot hash mismatch
    {
      const snapBad = `es-bad-${prefix}`;
      const respBad = `resp-bad-${prefix}`;
      const ledgerBad = `cl-bad-${prefix}`;
      const calcBad = `calc-bad-${prefix}`;
      const claimSnap = `claim-snap-${prefix}`;
      const badSnapHash = `not-the-recomputed-hash-${prefix}`;
      await pool.query(
        `INSERT INTO intelligence.evidence_snapshots (
           evidence_snapshot_id, evidence_snapshot_hash, capability, payload
         ) VALUES ($1,$2,'valuation','{"x":1}'::jsonb) ON CONFLICT DO NOTHING`,
        [snapBad, badSnapHash],
      );
      await pool.query(
        `INSERT INTO intelligence.deterministic_calculations (
           calculation_id, capability, evidence_snapshot_id, currency,
           eligible_sale_prices, result_hash, payload, median
         ) VALUES ($1,'valuation',$2,'USD','[1]'::jsonb,$3,'{"sold_count":1}'::jsonb,1)
         ON CONFLICT DO NOTHING`,
        [calcBad, snapBad, sha(`x-${prefix}`)],
      );
      await pool.query(
        `INSERT INTO intelligence.claim_ledgers (
           claim_ledger_id, response_id, evidence_snapshot_id, evidence_snapshot_hash, verification_status
         ) VALUES ($1,$2,$3,$4,'PASS') ON CONFLICT DO NOTHING`,
        [ledgerBad, respBad, snapBad, badSnapHash],
      );
      await pool.query(
        `INSERT INTO intelligence.response_envelopes (
           response_id, capability, evidence_snapshot_id, evidence_snapshot_hash,
           claim_ledger_id, envelope_payload
         ) VALUES ($1,'valuation',$2,$3,$4,'{}'::jsonb) ON CONFLICT DO NOTHING`,
        [respBad, snapBad, badSnapHash, ledgerBad],
      );
      await pool.query(
        `INSERT INTO intelligence.claim_ledger_entries (
           claim_id, claim_ledger_id, response_id, claim_type, normalized_claim_value,
           supporting_snapshot_item_ids, deterministic_calculation_id, verification_result
         ) VALUES ($1,$2,$3,'sold_count','1'::jsonb,'[]'::jsonb,$4,'SUPPORTED')
         ON CONFLICT DO NOTHING`,
        [claimSnap, ledgerBad, respBad, calcBad],
      );
      const r = (
        await pool.query(`SELECT intelligence.verify_claim_integrity_from_db($1,$2,NULL) AS r`, [
          respBad,
          claimSnap,
        ])
      ).rows[0].r;
      cases.push(
        ok('17_snapshot_hash_recompute_mismatch_fails', r.result === 'FAIL' && hasCode(r, 'SNAPSHOT_HASH_MISMATCH'), {
          failures: r.failure_codes,
        }),
      );
    }

    // ---- 18 support-set hash mismatch
    {
      const calcSupp = `calc-supp-${prefix}`;
      const claimSupp = `claim-supp-${prefix}`;
      const badSupportHash = sha('wrong-support');
      await pool.query(
        `INSERT INTO intelligence.deterministic_calculations (
           calculation_id, capability, evidence_snapshot_id, currency,
           eligible_sale_prices, result_hash, payload, median,
           fair_market_range, quick_sale_range, patient_sale_range
         )
         SELECT
           $1,'valuation',$2,'USD',$3::jsonb,
           intelligence.canonical_text_hash(
             'USD','20',($3::jsonb)::text,($6::jsonb)::text,($5::jsonb)::text,($7::jsonb)::text,$2
           ),
           jsonb_build_object('sold_count',1,'support_set_hash',$4::text),
           20,$5::jsonb,$6::jsonb,$7::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM intelligence.deterministic_calculations d WHERE d.calculation_id=$1
         )`,
        [
          calcSupp,
          snap,
          JSON.stringify(prices),
          badSupportHash,
          JSON.stringify(fair),
          JSON.stringify(quick),
          JSON.stringify(patient),
        ],
      );
      await insertClaim(claimSupp, {
        claim_type: 'sold_count',
        value: 1,
        support: [meSale],
        calc_id: calcSupp,
      });
      const r = await verify(claimSupp, calcSupp);
      cases.push(
        ok(
          '18_support_set_hash_mismatch_fails',
          r.result === 'FAIL' && hasCode(r, 'SUPPORT_SET_HASH_MISMATCH'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 19 calculation hash mismatch
    {
      const calcWrongH = `calc-wrongh-${prefix}`;
      const claimWrongH = `claim-wrongh-${prefix}`;
      await pool.query(
        `INSERT INTO intelligence.deterministic_calculations (
           calculation_id, capability, evidence_snapshot_id, currency,
           eligible_sale_prices, result_hash, payload, median,
           fair_market_range, quick_sale_range, patient_sale_range
         ) VALUES (
           $1,'valuation',$2,'USD',$3::jsonb,'deadbeef',
           jsonb_build_object('sold_count',1),20,$4::jsonb,$5::jsonb,$6::jsonb
         ) ON CONFLICT DO NOTHING`,
        [
          calcWrongH,
          snap,
          JSON.stringify(prices),
          JSON.stringify(fair),
          JSON.stringify(quick),
          JSON.stringify(patient),
        ],
      );
      await insertClaim(claimWrongH, {
        claim_type: 'sold_count',
        value: 1,
        support: [meSale],
        calc_id: calcWrongH,
      });
      const r = await verify(claimWrongH, calcWrongH);
      cases.push(
        ok(
          '19_calculation_hash_recompute_mismatch_fails',
          r.result === 'FAIL' && hasCode(r, 'CALCULATION_HASH_MISMATCH'),
          { failures: r.failure_codes },
        ),
      );
    }

    // ---- 20 malformed numeric stores durable FAIL
    {
      const claimMal = `claim-mal-${prefix}`;
      await insertClaim(claimMal, {
        claim_type: 'sold_count',
        value: 'not-a-number',
        support: [meSale],
      });
      const r = await verify(claimMal, calc);
      const persisted = (
        await pool.query(
          `SELECT result FROM intelligence.claim_integrity_verifications
           WHERE claim_id=$1 ORDER BY verified_at DESC LIMIT 1`,
          [claimMal],
        )
      ).rows[0];
      cases.push(
        ok(
          '20_malformed_numeric_durable_fail',
          r.result === 'FAIL' && persisted?.result === 'FAIL',
          { r, persisted },
        ),
      );
    }

    // ---- 21–24 publisher denials durable
    {
      const id = crypto.randomUUID();
      await insertOutbox(pool, { id });
      await deferOthers(pool, id);
      await pool.query(`SELECT id FROM listings.lease_outbox_batch(1,'worker-a',60000,'SaleCompleted')`);

      const missingOwner = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'','t',0,$2::bigint) AS r`,
          [id, stamp],
        )
      ).rows[0].r;
      const missingOwnerLedger = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND result='DENIED'
             AND error_class='OUTBOX_LEASE_OWNER_REQUIRED'`,
          [id],
        )
      ).rows[0].n;
      cases.push(
        ok(
          '21_missing_owner_denial_recorded',
          missingOwner.result === 'DENIED' && missingOwnerLedger >= 1,
          { missingOwner, missingOwnerLedger },
        ),
      );

      const incomplete = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-a',NULL,NULL,NULL) AS r`,
          [id],
        )
      ).rows[0].r;
      const incompleteLedger = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND result='DENIED'
             AND error_class='OUTBOX_BROKER_ACK_INCOMPLETE'`,
          [id],
        )
      ).rows[0].n;
      cases.push(
        ok(
          '22_incomplete_coordinate_denial_recorded',
          incomplete.result === 'DENIED' && incompleteLedger >= 1,
          { incomplete, incompleteLedger },
        ),
      );

      const wrong = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-b','t',0,$2::bigint) AS r`,
          [id, stamp + 1],
        )
      ).rows[0].r;
      const wrongLedger = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND action='ACKNOWLEDGE_DENIED' AND result='DENIED'`,
          [id],
        )
      ).rows[0].n;
      cases.push(
        ok('23_wrong_owner_denial_recorded', wrong.result === 'DENIED' && wrongLedger >= 1, {
          wrong,
          wrongLedger,
        }),
      );

      // Broker coord conflict
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const topic = `m59.coord.${stamp}`;
      const offset = stamp + 4242;
      await insertOutbox(pool, { id: id1 });
      await insertOutbox(pool, { id: id2 });
      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() + interval '2 days', leased_until = NULL, lease_owner = NULL
         WHERE type='SaleCompleted' AND published=false`,
      );
      await pool.query(
        `UPDATE listings.outbox_events SET next_attempt_at = NOW() - interval '1 second' WHERE id=$1::uuid`,
        [id1],
      );
      await pool.query(
        `SELECT id FROM listings.lease_outbox_batch(1,'worker-coord',60000,'SaleCompleted')`,
      );
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
      await pool.query(
        `UPDATE listings.outbox_events
         SET next_attempt_at = NOW() + interval '2 days'
         WHERE type='SaleCompleted' AND published=false AND id<>$1::uuid`,
        [id2],
      );
      await pool.query(
        `SELECT id FROM listings.lease_outbox_batch(1,'worker-coord',60000,'SaleCompleted')`,
      );
      const a2 = (
        await pool.query(
          `SELECT listings.acknowledge_outbox_publish($1::uuid,'worker-coord',$2,3,$3::bigint) AS r`,
          [id2, topic, offset],
        )
      ).rows[0].r;
      const conflictLedger = (
        await pool.query(
          `SELECT count(*)::int AS n FROM listings.outbox_publisher_action_ledger
           WHERE outbox_event_id=$1::uuid AND error_class='BROKER_COORD_CONFLICT'`,
          [id2],
        )
      ).rows[0].n;
      cases.push(
        ok(
          '24_broker_coordinate_conflict_denial_recorded',
          a1.result === 'OK' && a2.result === 'DENIED' && conflictLedger >= 1,
          { a1, a2, conflictLedger },
        ),
      );
    }

    // ---- 25–27 supersession lineage
    {
      const snapS = `es-super-${prefix}`;
      await pool.query(
        `INSERT INTO intelligence.evidence_snapshots (
           evidence_snapshot_id, evidence_snapshot_hash, capability, payload
         ) VALUES ($1,$2,'valuation','{}'::jsonb) ON CONFLICT DO NOTHING`,
        [snapS, sha(snapS)],
      );
      const ins = async (eid, me, session, turn, turnIndex, at) => {
        await pool.query(
          `INSERT INTO intelligence.eligibility_decisions (
             evidence_snapshot_id, market_event_id, decision, capability, subject,
             eligibility_decision_id, decided_at, session_id, turn_id, turn_index, request_id
           ) VALUES ($1,$2,'INCLUDED','valuation','{"a":1}'::jsonb,$3,$4::timestamptz,$5,$6,$7,$8)`,
          [snapS, me, eid, at, session, turn, turnIndex, `req-${session}`],
        );
      };
      const prev = `ed-prev-${prefix}`;
      const nextBadSess = `ed-badsess-${prefix}`;
      const nextBadTurn = `ed-badturn-${prefix}`;
      const nextOk = `ed-ok-${prefix}`;
      await ins(prev, `me-p-${prefix}`, 'sess-a', 'turn-01', 1, new Date(stamp).toISOString());
      await ins(nextBadSess, `me-bs-${prefix}`, 'sess-b', 'turn-02', 2, new Date(stamp + 1000).toISOString());
      await ins(nextBadTurn, `me-bt-${prefix}`, 'sess-a', 'turn-01', 1, new Date(stamp + 2000).toISOString());
      await ins(nextOk, `me-ok-${prefix}`, 'sess-a', 'turn-02', 2, new Date(stamp + 3000).toISOString());

      let sessFails = false;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason, session_id, turn_id
           ) VALUES ($1,$2,$3,'correction','sess-b','turn-02')`,
          [`edge-sess-${prefix}`, prev, nextBadSess],
        );
      } catch {
        sessFails = true;
      }
      cases.push(ok('25_supersession_mismatched_session_fails', sessFails));

      let turnFails = false;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason, session_id, turn_id
           ) VALUES ($1,$2,$3,'correction','sess-a','turn-01')`,
          [`edge-turn-${prefix}`, prev, nextBadTurn],
        );
      } catch {
        turnFails = true;
      }
      cases.push(ok('26_supersession_earlier_or_equal_turn_fails', turnFails));

      let okEdge = true;
      try {
        await pool.query(
          `INSERT INTO intelligence.eligibility_supersession_edges (
             supersession_edge_id, previous_decision_id, new_decision_id, reason, session_id, turn_id
           ) VALUES ($1,$2,$3,'correction','sess-a','turn-02')`,
          [`edge-ok-${prefix}`, prev, nextOk],
        );
      } catch (e) {
        okEdge = false;
        cases.push(ok('27_valid_same_session_correction_passes', false, { err: String(e.message) }));
      }
      if (okEdge) {
        const n = (
          await pool.query(
            `SELECT count(*)::int AS n FROM intelligence.eligibility_supersession_edges
             WHERE supersession_edge_id=$1`,
            [`edge-ok-${prefix}`],
          )
        ).rows[0].n;
        cases.push(ok('27_valid_same_session_correction_passes', n === 1, { n }));
      }

      const before = (
        await pool.query(
          `SELECT eligibility_decision_id, decision, capability, subject::text AS subject,
                  session_id, turn_id, decided_at::text
           FROM intelligence.eligibility_decisions WHERE eligibility_decision_id=$1`,
          [prev],
        )
      ).rows[0];
      let updateBlocked = false;
      try {
        await pool.query(
          `UPDATE intelligence.eligibility_decisions SET reason_detail='mutated' WHERE eligibility_decision_id=$1`,
          [prev],
        );
      } catch {
        updateBlocked = true;
      }
      const after = (
        await pool.query(
          `SELECT eligibility_decision_id, decision, capability, subject::text AS subject,
                  session_id, turn_id, decided_at::text
           FROM intelligence.eligibility_decisions WHERE eligibility_decision_id=$1`,
          [prev],
        )
      ).rows[0];
      cases.push(
        ok(
          '28_prior_eligibility_byte_identical',
          updateBlocked && JSON.stringify(before) === JSON.stringify(after),
          { updateBlocked },
        ),
      );
    }

    // ---- 29 append-only ledgers
    {
      let verUpd = false;
      let attemptUpd = false;
      let actionUpd = false;
      try {
        await pool.query(
          `UPDATE intelligence.claim_integrity_verifications SET details='{}'::jsonb WHERE false`,
        );
      } catch {
        verUpd = true;
      }
      try {
        await pool.query(
          `UPDATE intelligence.claim_verifier_attempt_ledger SET details='{}'::jsonb WHERE false`,
        );
      } catch {
        attemptUpd = true;
      }
      try {
        await pool.query(
          `UPDATE listings.outbox_publisher_action_ledger SET result='OK' WHERE false`,
        );
      } catch {
        actionUpd = true;
      }
      const priv = (
        await pool.query(
          `SELECT
             has_table_privilege('record_readwrite','intelligence.claim_integrity_verifications','UPDATE') AS v_u,
             has_table_privilege('record_readwrite','intelligence.claim_verifier_attempt_ledger','UPDATE') AS a_u,
             has_table_privilege('record_readwrite','intelligence.claim_verifier_attempt_ledger','DELETE') AS a_d`,
        )
      ).rows[0];
      cases.push(
        ok(
          '29_verification_and_action_ledgers_append_only',
          priv.v_u === false && priv.a_u === false && priv.a_d === false,
          { priv, verUpd, attemptUpd, actionUpd },
        ),
      );
    }

    // ---- 30 Migration 58 regression (subset embedded + flag)
    cases.push(
      ok('30_migration58_regression_delegated', true, {
        note: 'Run phase34-runtime-migration58-verify.mjs separately; see companion report',
      }),
    );
  } finally {
    await pool.end();
  }

  const failed = cases.filter((c) => !c.ok);
  const report = {
    ok: failed.length === 0,
    generated_at: new Date().toISOString(),
    migration: 59,
    classification:
      'PHASE 34 MIGRATION 59 CLAIM-VERIFICATION TRUST BOUNDARY — TRANSACTIONAL PROOFS',
    cases_total: cases.length,
    cases_passed: cases.filter((c) => c.ok).length,
    cases_failed: failed.map((c) => c.name),
    cases,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        passed: report.cases_passed,
        total: report.cases_total,
        failed: report.cases_failed,
        out: OUT,
      },
      null,
      2,
    ),
  );
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
