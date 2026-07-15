import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { analyzeScarcity } from '../scripts/lib/phase33c-scarcity.mjs';
import { analyzeValuation, normalizeCurrency } from '../scripts/lib/phase33c-valuation.mjs';
import { analyzeAuction } from '../scripts/lib/phase33c-auction.mjs';
import { selectEvidence } from '../scripts/lib/phase33c-evidence.mjs';
import { validatePhase33cPackage } from '../scripts/lib/phase33c-verify.mjs';
import { evaluateScenario } from '../scripts/lib/phase33c-intelligence.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(REPO_ROOT, 'scripts/ai-platform/run-phase33c-capability.mjs');
const VERIFY = path.join(REPO_ROOT, 'scripts/ai-platform/verify-phase33c.mjs');

function sold(id, pressing, price = 50) {
  return {
    evidence_id: id,
    source_type: 'sale',
    source_id: id,
    sale_kind: 'sold',
    price,
    currency: 'USD',
    pressing_id: pressing,
    release_id: 'R1',
    observed_at: '2026-06-01T12:00:00.000Z',
    retrieved_at: '2026-06-01T12:00:00.000Z',
    summary: `sold ${id}`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
  };
}

describe('phase33c market intelligence', () => {
  it('package validates', () => {
    const report = validatePhase33cPackage(REPO_ROOT);
    assert.equal(report.status, 'PASS', report.violations.join('\n'));
    assert.ok(report.counts.total >= 550);
  });

  it('CLI JSON stdout', () => {
    const r = spawnSync(process.execPath, [VERIFY], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, 'PASS');
  });

  it('scarcity exact pressing match', () => {
    const out = analyzeScarcity({
      subject: { release_id: 'R1', pressing_id: 'P1' },
      candidates: [sold('a', 'P1', 40), sold('b', 'P1', 42)],
      active_supply_count: 2,
      recent_sale_count: 2,
    });
    assert.equal(out.envelope.abstention.abstained, false);
    assert.equal(out.result.scope, 'pressing');
  });

  it('scarcity zero-result abstention / false-rarity prevention', () => {
    const out = analyzeScarcity({
      subject: { release_id: 'R1', pressing_id: 'P1' },
      candidates: [],
      claim_rarity_from_zero_results: true,
    });
    assert.equal(out.envelope.abstention.abstained, true);
    assert.equal(out.result.scarcity_label, 'insufficient_data');
  });

  it('scarcity stale-only abstention', () => {
    const out = analyzeScarcity({
      subject: { release_id: 'R1', pressing_id: 'P1' },
      candidates: [
        {
          ...sold('stale', 'P1', 40),
          observed_at: '2024-01-01T12:00:00.000Z',
          retrieved_at: '2024-01-01T12:00:00.000Z',
          stale_labeled: true,
        },
      ],
    });
    assert.equal(out.envelope.abstention.abstained, true);
  });

  it('scarcity unauthorized private inventory excluded', () => {
    const sel = selectEvidence({
      candidates: [
        {
          evidence_id: 'priv',
          source_type: 'public_metadata',
          source_id: 'priv',
          summary: 'note',
          privacy_class: 'OWNER_PRIVATE',
          owner_principal_fixture: 'principal_fixture_seller_b',
          authorization_scope: 'owner_inventory',
          observed_at: '2026-07-01T12:00:00.000Z',
          retrieved_at: '2026-07-01T12:00:00.000Z',
        },
      ],
      principalId: 'principal_fixture_buyer_a',
      authorizedScopes: ['public_market', 'authenticated_market'],
    });
    assert.equal(sel.selected.length, 0);
    assert.ok(sel.excluded.some((e) => e.reason_codes.includes('UNAUTHORIZED')));
  });

  it('valuation range ordering and sold vs asking', () => {
    const out = analyzeValuation({
      subject: { release_id: 'R1', pressing_id: 'P1', condition: 'VG+' },
      currency: 'USD',
      candidates: [
        sold('a', 'P1', 50),
        sold('b', 'P1', 55),
        sold('c', 'P1', 52),
        {
          ...sold('ask', 'P1', 90),
          sale_kind: 'asking',
          source_type: 'listing',
        },
      ],
    });
    assert.equal(out.envelope.abstention.abstained, false);
    assert.ok(out.result.low_estimate <= out.result.fair_value);
    assert.ok(out.result.fair_value <= out.result.high_estimate);
    assert.equal(out.result.comparable_sales.length, 3);
    assert.equal(out.result.active_comparables.length, 1);
  });

  it('valuation currency normalization', () => {
    const n = normalizeCurrency(10, 'EUR', 'USD');
    assert.equal(n.ok, true);
    assert.ok(Math.abs(n.amount - 11) < 1e-9);
  });

  it('valuation wrong pressing exclusion and weak abstention', () => {
    const out = analyzeValuation({
      subject: { release_id: 'R1', pressing_id: 'P1' },
      candidates: [sold('x', 'OTHER', 50)],
      min_sold_comps: 2,
    });
    assert.equal(out.envelope.abstention.abstained, true);
  });

  it('valuation asking-as-sold trap filtered', () => {
    const out = analyzeValuation({
      subject: { release_id: 'R1', pressing_id: 'P1' },
      candidates: [
        sold('a', 'P1', 50),
        sold('b', 'P1', 52),
        {
          ...sold('trap', 'P1', 80),
          sale_kind: 'asking',
          source_type: 'listing',
          asking_presented_as_sold: true,
        },
      ],
    });
    assert.equal(out.diagnostics.asking_as_sold_violations, 0);
  });

  it('auction single + no-bid + late pressure', () => {
    const out = analyzeAuction({
      analysis_mode: 'single_auction',
      subject: { lot_id: 'L1' },
      auction: {
        lot_id: 'L1',
        current_price: 40,
        bid_count: 0,
        bid_velocity: 0,
        late_bid_pressure: 0,
        price_acceleration: 0,
        observed_at: '2026-07-15T12:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
    });
    assert.ok(out.result.risk_flags.includes('NO_BIDS'));
  });

  it('auction watchlist temperature authorized', () => {
    const out = analyzeAuction({
      analysis_mode: 'watchlist_batch',
      requesting_principal_fixture: 'principal_fixture_buyer_a',
      watchlist_owner_principal_fixture: 'principal_fixture_buyer_a',
      watchlist_auctions: [
        {
          lot_id: 'A',
          current_price: 10,
          bid_count: 4,
          bid_velocity: 2,
          late_bid_pressure: 0.7,
          price_acceleration: 0.2,
          end_at: '2026-07-16T10:00:00.000Z',
          release_id: 'R',
          observed_at: '2026-07-15T12:00:00.000Z',
        },
        {
          lot_id: 'B',
          current_price: 12,
          bid_count: 5,
          bid_velocity: 3,
          late_bid_pressure: 0.8,
          price_acceleration: 0.3,
          end_at: '2026-07-16T10:00:00.000Z',
          release_id: 'R',
          observed_at: '2026-07-15T12:00:00.000Z',
        },
        {
          lot_id: 'C',
          current_price: 14,
          bid_count: 2,
          bid_velocity: 1,
          late_bid_pressure: 0.4,
          price_acceleration: 0.1,
          end_at: '2026-07-16T11:00:00.000Z',
          release_id: 'R2',
          observed_at: '2026-07-15T12:00:00.000Z',
        },
      ],
    });
    assert.equal(out.envelope.abstention.abstained, false);
    assert.ok(out.result.auction_count >= 3);
  });

  it('auction unauthorized watchlist rejection', () => {
    const out = analyzeAuction({
      analysis_mode: 'watchlist_batch',
      requesting_principal_fixture: 'principal_fixture_buyer_a',
      watchlist_owner_principal_fixture: 'principal_fixture_buyer_b',
      unauthorized_watchlist: true,
      watchlist_auctions: [
        {
          lot_id: 'A',
          current_price: 10,
          bid_count: 1,
          bid_velocity: 1,
          late_bid_pressure: 0.1,
          price_acceleration: 0,
          observed_at: '2026-07-15T12:00:00.000Z',
        },
      ],
    });
    assert.equal(out.diagnostics.unauthorized_watchlist, true);
    assert.equal(out.envelope.abstention.abstained, true);
    assert.equal(out.result.auction_count, 0);
  });

  it('auction bidder identity and collusion refusal', () => {
    const out = analyzeAuction({
      analysis_mode: 'single_auction',
      subject: { lot_id: 'L1' },
      auction: {
        lot_id: 'L1',
        current_price: 40,
        bid_count: 3,
        bid_velocity: 1,
        late_bid_pressure: 0.2,
        price_acceleration: 0.1,
        observed_at: '2026-07-15T12:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
      request_bidder_identity: true,
      claim_collusion: true,
    });
    assert.equal(out.envelope.abstention.abstained, true);
    assert.equal(out.diagnostics.bidder_identity_exposure, 0);
  });

  it('deleted auction exclusion', () => {
    const out = analyzeAuction({
      analysis_mode: 'single_auction',
      subject: { lot_id: 'L1' },
      auction: {
        lot_id: 'L1',
        current_price: 40,
        bid_count: 3,
        bid_velocity: 1,
        late_bid_pressure: 0.2,
        price_acceleration: 0.1,
        observed_at: '2026-07-15T12:00:00.000Z',
        deletion_state: 'DELETED',
      },
    });
    assert.equal(out.envelope.abstention.abstained, true);
  });

  it('runner stdout/stderr separation and no silent mode fallback', () => {
    const r = spawnSync(process.execPath, [RUNNER], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: JSON.stringify({
        capability: 'scarcity',
        input: {
          subject: { release_id: 'R1', pressing_id: 'P1' },
          candidates: [sold('a', 'P1'), sold('b', 'P1')],
        },
      }),
    });
    assert.equal(r.status, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.status, 'PASS');
    assert.equal(body.diagnostics.retrieval_mode, 'keyword_metadata');
  });

  it('production hard stops in policy', () => {
    const policy = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'scripts/ai-platform/phase33c-acceptance-policy.json'),
        'utf8',
      ),
    );
    assert.equal(policy.production_hard_stops.PERCENT, 0);
    assert.equal(policy.production_hard_stops.ALLOW_PROD_PERCENT, 0);
    assert.equal(policy.production_hard_stops.default, 'keyword');
    assert.equal(policy.phase33b_metric_interpretation.reclassified_as_pass, false);
  });

  it('scenario evaluation hard stops remain zero on sample suite', () => {
    const scenarios = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'scripts/ai-platform/phase33c-scenarios/scarcity-scenarios.json'),
        'utf8',
      ),
    ).scenarios.slice(0, 20);
    for (const s of scenarios) {
      const r = evaluateScenario(s);
      assert.equal(r.hard.privacy_leakage, 0);
      assert.equal(r.hard.schema_invalid_outputs, 0);
    }
  });
});
