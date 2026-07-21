/**
 * Persist Phase 34 evidence artifacts to intelligence.* (append-only).
 * Used by the live capability response path when PHASE34_RUNTIME_PERSIST != 0.
 */

const DEFAULT_URL =
  process.env.POSTGRES_URL_LISTINGS ||
  process.env.LISTINGS_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';

async function loadPg() {
  try {
    const mod = await import('pg');
    return mod.default || mod;
  } catch (err) {
    const e = new Error(`PG_MODULE_UNAVAILABLE:${err?.message || err}`);
    e.code = 'PG_MODULE_UNAVAILABLE';
    throw e;
  }
}

export async function createListingsPool(connectionString = DEFAULT_URL) {
  const pg = await loadPg();
  return new pg.Pool({ connectionString, max: 4 });
}

/**
 * Persist snapshot + eligibility decisions + claim ledger + response envelope.
 * Idempotent on primary keys / unique natural keys (ON CONFLICT DO NOTHING).
 */
export async function persistCapabilityEvidenceArtifacts(
  {
    snapshot,
    claimLedger,
    envelope = null,
    capability,
    subject = {},
    requestedConstraints = {},
    calculation = null,
  },
  { pool = null, connectionString = DEFAULT_URL } = {},
) {
  if (!snapshot?.evidence_snapshot_id || !snapshot?.evidence_snapshot_hash) {
    const err = new Error('PERSIST_REQUIRES_SNAPSHOT');
    err.code = 'PERSIST_REQUIRES_SNAPSHOT';
    throw err;
  }
  if (!claimLedger?.claim_ledger_id) {
    const err = new Error('PERSIST_REQUIRES_CLAIM_LEDGER');
    err.code = 'PERSIST_REQUIRES_CLAIM_LEDGER';
    throw err;
  }

  const owned = !pool;
  const db = pool || (await createListingsPool(connectionString));
  const client = await db.connect();
  const result = {
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    claim_ledger_id: claimLedger.claim_ledger_id,
    eligibility_rows: 0,
    snapshot_items: 0,
    claim_entries: 0,
    envelope_persisted: false,
    calculation_persisted: false,
  };

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO intelligence.evidence_snapshots (
         evidence_snapshot_id, evidence_snapshot_hash, evidence_snapshot_version,
         capability, request_id, session_id, turn_id,
         requested_constraints, source_rights_distribution, event_type_distribution,
         data_time_range_start, data_time_range_end, freshness,
         dedupe_version, eligibility_version, retrieval_version, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9::jsonb, $10::jsonb,
         $11::timestamptz, $12::timestamptz, $13::jsonb,
         $14, $15, $16, $17::jsonb
       )
       ON CONFLICT (evidence_snapshot_id) DO NOTHING`,
      [
        snapshot.evidence_snapshot_id,
        snapshot.evidence_snapshot_hash,
        snapshot.evidence_snapshot_version || 'phase34-evidence-snapshot-v2',
        capability || snapshot.capability,
        snapshot.request_id || null,
        snapshot.session_id || null,
        snapshot.turn_id || null,
        JSON.stringify(requestedConstraints || snapshot.requested_constraints || {}),
        JSON.stringify(snapshot.source_rights_distribution || {}),
        JSON.stringify(snapshot.event_type_distribution || {}),
        snapshot.data_time_range?.start || null,
        snapshot.data_time_range?.end || null,
        JSON.stringify(snapshot.freshness || {}),
        snapshot.dedupe_version || 'phase34-dedupe-v1',
        snapshot.eligibility_version || 'phase34-eligibility-v1',
        snapshot.retrieval_version || 'phase34-retrieval-v1',
        JSON.stringify({
          included_event_ids: snapshot.included_event_ids || [],
          excluded_event_ids: snapshot.excluded_event_ids || [],
          subject_resolution: snapshot.subject_resolution || null,
        }),
      ],
    );

    await client.query(
      `INSERT INTO intelligence.evidence_snapshot_subjects (
         evidence_snapshot_id, subject_role, subject_payload, resolution_status
       ) VALUES ($1, 'primary', $2::jsonb, $3)
       ON CONFLICT (evidence_snapshot_id, subject_role) DO NOTHING`,
      [
        snapshot.evidence_snapshot_id,
        JSON.stringify(subject || snapshot.subject || {}),
        snapshot.subject_resolution?.resolution_status || null,
      ],
    );

    if (snapshot.query_plan || snapshot.retrieval_execution) {
      await client.query(
        `INSERT INTO intelligence.evidence_snapshot_queries (
           evidence_snapshot_id, query_plan, retrieval_execution
         ) VALUES ($1, $2::jsonb, $3::jsonb)
         ON CONFLICT (evidence_snapshot_id) DO NOTHING`,
        [
          snapshot.evidence_snapshot_id,
          JSON.stringify(snapshot.query_plan || {}),
          JSON.stringify(snapshot.retrieval_execution || {}),
        ],
      );
    }

    const included = snapshot.eligibility?.included || [];
    for (const e of included) {
      const evidenceId = e.evidence_id || e.market_event_id;
      if (!evidenceId) continue;
      await client.query(
        `INSERT INTO intelligence.evidence_snapshot_items (
           evidence_snapshot_id, market_event_id, evidence_id, event_type,
           sale_kind, pressing_match, included, item_payload
         ) VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb)
         ON CONFLICT (evidence_snapshot_id, evidence_id) DO NOTHING`,
        [
          snapshot.evidence_snapshot_id,
          e.market_event_id || null,
          evidenceId,
          e.event_type || null,
          e.sale_kind || null,
          e.pressing_match || null,
          JSON.stringify(e),
        ],
      );
      result.snapshot_items += 1;
    }

    for (const x of snapshot.excluded_event_ids || []) {
      await client.query(
        `INSERT INTO intelligence.evidence_snapshot_exclusions (
           evidence_snapshot_id, market_event_id, evidence_id, decision, reason_detail
         )
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM intelligence.evidence_snapshot_exclusions e
           WHERE e.evidence_snapshot_id = $1
             AND COALESCE(e.market_event_id, '') = COALESCE($2, '')
             AND COALESCE(e.evidence_id, '') = COALESCE($3, '')
             AND e.decision = $4
         )`,
        [
          snapshot.evidence_snapshot_id,
          x.id || null,
          x.id || null,
          x.decision || 'EXCLUDED_UNRESOLVED',
          x.reason || null,
        ],
      );
    }

    const decisions = snapshot.eligibility?.decisions || [];
    for (const d of decisions) {
      const mid = d.market_event_id || d.evidence_id;
      if (!mid) continue;
      const decisionId =
        d.eligibility_decision_id ||
        `ed-${snapshot.evidence_snapshot_id}-${mid}`.slice(0, 120);
      await client.query(
        `INSERT INTO intelligence.eligibility_decisions (
           evidence_snapshot_id, market_event_id, decision, reason_detail,
           eligibility_version, capability, subject, requested_constraints,
           entity_resolution_version, dedupe_version, decided_at,
           eligibility_decision_id, request_id, session_id, turn_id,
           previous_decision_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW(),
           $11, $12, $13, $14, $15
         )
         ON CONFLICT (evidence_snapshot_id, market_event_id) DO NOTHING`,
        [
          snapshot.evidence_snapshot_id,
          mid,
          d.decision,
          d.reason_detail || null,
          d.eligibility_version || snapshot.eligibility_version || 'phase34-eligibility-v1',
          capability || snapshot.capability || null,
          JSON.stringify(subject || {}),
          JSON.stringify(requestedConstraints || snapshot.requested_constraints || {}),
          snapshot.subject_resolution?.resolution_version || 'phase34-entity-resolution-v1',
          snapshot.dedupe_version || 'phase34-dedupe-v1',
          decisionId,
          snapshot.request_id || null,
          snapshot.session_id || null,
          snapshot.turn_id || null,
          d.previous_decision_id || null,
        ],
      );
      result.eligibility_rows += 1;
    }

    if (calculation?.calculation_id) {
      await client.query(
        `INSERT INTO intelligence.deterministic_calculations (
           calculation_id, capability, evidence_snapshot_id, algorithm_version,
           currency, eligible_sale_prices, normalized_prices, time_range,
           condition_adjustments, outlier_decisions, median, dispersion,
           quick_sale_range, fair_market_range, patient_sale_range,
           confidence_inputs, result_hash, payload
         ) VALUES (
           $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
           $9::jsonb, $10::jsonb, $11, $12,
           $13::jsonb, $14::jsonb, $15::jsonb,
           $16::jsonb, $17, $18::jsonb
         )
         ON CONFLICT (calculation_id) DO NOTHING`,
        [
          calculation.calculation_id,
          calculation.capability || capability || 'valuation',
          snapshot.evidence_snapshot_id,
          calculation.algorithm_version || 'phase34-valuation-calc-v1',
          calculation.currency || 'USD',
          JSON.stringify(calculation.eligible_sale_prices || []),
          JSON.stringify(calculation.normalized_prices || []),
          JSON.stringify(calculation.time_range || {}),
          JSON.stringify(calculation.condition_adjustments || {}),
          JSON.stringify(calculation.outlier_decisions || []),
          calculation.median,
          calculation.dispersion,
          JSON.stringify(calculation.quick_sale_range),
          JSON.stringify(calculation.fair_market_range),
          JSON.stringify(calculation.patient_sale_range),
          JSON.stringify(calculation.confidence_inputs || {}),
          calculation.result_hash,
          JSON.stringify(calculation.payload || calculation),
        ],
      );
      result.calculation_persisted = true;
      result.calculation_id = calculation.calculation_id;
    }

    await client.query(
      `INSERT INTO intelligence.claim_ledgers (
         claim_ledger_id, response_id, evidence_snapshot_id, evidence_snapshot_hash,
         verification_status
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (claim_ledger_id) DO NOTHING`,
      [
        claimLedger.claim_ledger_id,
        claimLedger.response_id,
        snapshot.evidence_snapshot_id,
        snapshot.evidence_snapshot_hash,
        claimLedger.verification_status || 'PASS',
      ],
    );

    for (const entry of claimLedger.entries || []) {
      await client.query(
        `INSERT INTO intelligence.claim_ledger_entries (
           claim_id, claim_ledger_id, response_id, claim_type,
           normalized_claim_value, supporting_snapshot_item_ids,
           deterministic_calculation_id, synthesis_path, verification_result
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
         ON CONFLICT (claim_id) DO NOTHING`,
        [
          entry.claim_id,
          claimLedger.claim_ledger_id,
          claimLedger.response_id,
          entry.claim_type,
          JSON.stringify(entry.normalized_claim_value),
          JSON.stringify(entry.supporting_snapshot_item_ids || []),
          entry.deterministic_calculation_id || null,
          entry.synthesis_path || null,
          entry.verification_result,
        ],
      );
      result.claim_entries += 1;
    }

    if (envelope?.response_id) {
      await client.query(
        `INSERT INTO intelligence.response_envelopes (
           response_id, capability, envelope_version,
           evidence_snapshot_id, evidence_snapshot_hash, claim_ledger_id,
           session_state_version, envelope_payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (response_id) DO NOTHING`,
        [
          envelope.response_id,
          capability || snapshot.capability,
          envelope.envelope_version || 'phase34-response-envelope-v1',
          snapshot.evidence_snapshot_id,
          snapshot.evidence_snapshot_hash,
          claimLedger.claim_ledger_id,
          envelope.session_state_version || null,
          JSON.stringify({
            answer: envelope.answer || null,
            customer_summary: envelope.customer_summary || null,
            key_values: envelope.key_values || {},
            limitations: envelope.limitations || [],
          }),
        ],
      );
      result.envelope_persisted = true;
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    if (owned) await db.end();
  }
}
