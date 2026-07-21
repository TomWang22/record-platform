#!/usr/bin/env node
/**
 * Prove valuation customer answer → claim ledger → evidence snapshot →
 * three settlement-backed SALE_COMPLETED market events (runtime path).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runCapabilityAsync } from '../lib/phase33c-intelligence.mjs';

const EVIDENCE_ROOT =
  process.env.PHASE34_RUNTIME_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v1';
const REPORT_DIR = path.join(
  process.cwd(),
  'reports/phase34-runtime-integration',
);
const LISTINGS_URL =
  process.env.POSTGRES_URL_LISTINGS ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';

async function main() {
  const out = await runCapabilityAsync('valuation', {
    runtime_integration: true,
    persist_evidence: true,
    request_id: `req-valuation-lineage-${Date.now()}`,
    session_id: 'sess-phase34-runtime-valuation',
    turn_id: 'turn-1',
    subject: { currency: 'USD' },
    constraints: { currency: 'USD' },
    market_event_limit: 3,
    currency: 'USD',
    min_sold_comps: 3,
  });

  const snap = out.platform_envelope?.evidence_snapshot;
  const ledger = out.platform_envelope?.claim_ledger;
  const soldClaim = (ledger?.entries || []).find((e) => e.claim_type === 'sold_count');
  const included = snap?.included_event_ids || [];

  const pool = new pg.Pool({ connectionString: LISTINGS_URL, max: 2 });
  let dbVerify = {};
  try {
    const { rows: snapRows } = await pool.query(
      `SELECT evidence_snapshot_id, evidence_snapshot_hash, capability
       FROM intelligence.evidence_snapshots WHERE evidence_snapshot_id = $1`,
      [out.evidence_snapshot_id],
    );
    const { rows: elig } = await pool.query(
      `SELECT market_event_id, decision FROM intelligence.eligibility_decisions
       WHERE evidence_snapshot_id = $1 ORDER BY market_event_id`,
      [out.evidence_snapshot_id],
    );
    const { rows: claims } = await pool.query(
      `SELECT claim_id, claim_type, normalized_claim_value, supporting_snapshot_item_ids,
              verification_result
       FROM intelligence.claim_ledger_entries WHERE claim_ledger_id = $1`,
      [out.claim_ledger_id],
    );
    const supporting = soldClaim?.supporting_snapshot_item_ids || [];
    const { rows: market } = await pool.query(
      `SELECT market_event_id, event_type, observation_id, payload_hash
       FROM intelligence.market_events WHERE market_event_id = ANY($1::text[])`,
      [supporting],
    );
    dbVerify = {
      snapshot_row: snapRows[0] || null,
      eligibility_decisions: elig,
      claim_entries: claims,
      supporting_market_events: market,
    };
  } finally {
    await pool.end();
  }

  const ok =
    Boolean(out.evidence_snapshot_id) &&
    Boolean(out.evidence_snapshot_hash) &&
    Boolean(out.claim_ledger_id) &&
    Boolean(out.persistence?.evidence_snapshot_id) &&
    included.length >= 3 &&
    soldClaim?.verification_result === 'SUPPORTED' &&
    (soldClaim?.supporting_snapshot_item_ids || []).length >= 3 &&
    (dbVerify.supporting_market_events || []).length >= 3 &&
    (dbVerify.supporting_market_events || []).every((r) => r.event_type === 'SALE_COMPLETED');

  const dossier = {
    ok,
    generated_at: new Date().toISOString(),
    capability: 'valuation',
    customer_summary: out.platform_envelope?.customer_summary || null,
    evidence_snapshot_id: out.evidence_snapshot_id,
    evidence_snapshot_hash: out.evidence_snapshot_hash,
    claim_ledger_id: out.claim_ledger_id,
    response_id: out.response_id,
    included_event_ids: included,
    sold_count_claim: soldClaim || null,
    persistence: out.persistence || null,
    diagnostics: out.diagnostics || null,
    db_verify: dbVerify,
    blockers: ok
      ? []
      : [
          included.length < 3 ? 'fewer_than_three_included_sales' : null,
          !soldClaim ? 'missing_sold_count_claim' : null,
          soldClaim?.verification_result !== 'SUPPORTED' ? 'sold_count_not_supported' : null,
          (dbVerify.supporting_market_events || []).length < 3
            ? 'supporting_events_missing_in_market_events'
            : null,
        ].filter(Boolean),
  };

  fs.mkdirSync(path.join(EVIDENCE_ROOT, 'dossiers'), { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const name = 'valuation-three-sales-claim-lineage.json';
  fs.writeFileSync(path.join(EVIDENCE_ROOT, 'dossiers', name), JSON.stringify(dossier, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_ROOT, name), JSON.stringify(dossier, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, name), JSON.stringify(dossier, null, 2));
  process.stdout.write(JSON.stringify(dossier, null, 2) + '\n');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
