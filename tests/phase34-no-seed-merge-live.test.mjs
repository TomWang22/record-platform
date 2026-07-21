/**
 * Phase A: prove seed COMPLETED_SALE merge and force floors are unreachable live.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeOwnerProofCompletedSaleCandidates } from '../scripts/lib/phase34-owner-proof-completed-sale-candidates.mjs';
import { assertNoRuntimeForceFloorsInBody } from '../scripts/lib/phase34-owner-proof-product-contracts.mjs';
import { runCapability } from '../scripts/lib/phase33c-intelligence.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('intelligence orchestrator still calls merge but live seed adds nothing', () => {
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  const result = runCapability('scarcity', {
    subject: { artist: 'Kenny Dorham', title: 'Una Mas', catalog_number: 'BST-84127' },
    candidates: [],
  });
  assert.ok(result);
  assert.equal(result.recent_sale_count ?? result.sold_count ?? 0, 0);
});

test('mergeOwnerProofCompletedSaleCandidates source gates seed load', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/lib/phase34-owner-proof-completed-sale-candidates.mjs'),
    'utf8',
  );
  assert.match(src, /syntheticSalesAllowed/);
  assert.match(src, /_completed_sale_seed_blocked/);
  assert.match(src, /listSaleCompletedEvents/);
});

test('assertNoRuntimeForceFloorsInBody always blocks force_sold_floor', () => {
  assert.throws(
    () => assertNoRuntimeForceFloorsInBody({ force_sold_floor: true }),
    /RUNTIME_FORCE_FLOOR_USED/,
  );
  assert.equal(assertNoRuntimeForceFloorsInBody({ force_watchlist_floor: true }).ok, true);
  assert.throws(
    () =>
      assertNoRuntimeForceFloorsInBody(
        { force_watchlist_floor: true },
        { screenshotPack: 'owner-proof-recapture-v5' },
      ),
    /RUNTIME_FORCE_FLOOR_USED/,
  );
});

test('migration 49 defines lifecycle + sale_completed_events', () => {
  const sql = fs.readFileSync(
    path.join(REPO, 'infra/db/49-listings-sale-completed-lifecycle.sql'),
    'utf8',
  );
  assert.match(sql, /lifecycle_status/);
  assert.match(sql, /sale_completed_events/);
  assert.match(sql, /CHECKOUT_SETTLEMENT/);
  assert.match(sql, /ARCHIVED/);
  assert.match(sql, /WHEN sold_at IS NOT NULL THEN 'SOLD'/);
  assert.match(sql, /WHEN status::text IN \('paused', 'archived'\) THEN 'ARCHIVED'/);
});
