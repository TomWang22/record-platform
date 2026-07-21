/**
 * Phase A regression: listing lifecycle + SALE_COMPLETED settlement path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LISTING_LIFECYCLE,
  normalizeListingLifecycle,
  assertNeverSoldFromArchive,
  isArchivedLifecycle,
} from '../scripts/lib/phase34-listing-lifecycle.mjs';
import {
  buildSaleCompletedEvent,
  isSettlementSaleCompleted,
  SETTLEMENT_SOURCES,
  SALE_COMPLETED_EVENT_TYPE,
} from '../scripts/lib/phase34-sale-completed-emitter.mjs';
import {
  persistSaleCompletedEvent,
  resetSaleCompletedStoreForTests,
  listSaleCompletedEvents,
} from '../scripts/lib/phase34-sale-completed-store.mjs';
import { mergeOwnerProofCompletedSaleCandidates } from '../scripts/lib/phase34-owner-proof-completed-sale-candidates.mjs';
import { analyzeScarcity } from '../scripts/lib/phase33c-scarcity.mjs';
import { analyzeValuation } from '../scripts/lib/phase33c-valuation.mjs';
import { EVENT_TYPES } from '../scripts/lib/phase34-market-event-normalization.mjs';
import { buildEvidenceSnapshot } from '../scripts/lib/phase34-evidence-snapshot.mjs';

test('canonical lifecycle values are complete', () => {
  assert.deepEqual(Object.values(LISTING_LIFECYCLE).sort(), [
    'ACTIVE',
    'ARCHIVED',
    'CANCELLED',
    'ENDED_UNSOLD',
    'EXPIRED',
    'SOLD',
  ].sort());
});

test('archived / paused never normalize to SOLD even with soldAt', () => {
  assert.equal(normalizeListingLifecycle('archived', { soldAt: '2026-07-01' }), 'ARCHIVED');
  assert.equal(normalizeListingLifecycle('paused', { soldAt: '2026-07-01' }), 'ARCHIVED');
  assert.equal(isArchivedLifecycle('archived', { soldAt: '2026-07-01' }), true);
  assert.throws(() => assertNeverSoldFromArchive('archived'), /LISTING_ARCHIVED_IS_NOT_SOLD/);
  assert.throws(() => assertNeverSoldFromArchive('paused'), /LISTING_ARCHIVED_IS_NOT_SOLD/);
});

test('closed without settlement is ENDED_UNSOLD not SOLD', () => {
  assert.equal(normalizeListingLifecycle('closed'), 'ENDED_UNSOLD');
  assert.throws(
    () => assertNeverSoldFromArchive('closed'),
    /LISTING_ENDED_WITHOUT_SETTLEMENT_IS_NOT_SOLD/,
  );
});

test('SALE_COMPLETED requires settlement source and rejects archive', () => {
  assert.ok(EVENT_TYPES.includes('SALE_COMPLETED'));
  assert.throws(
    () =>
      buildSaleCompletedEvent({
        listing_id: 'listing-1',
        final_price: 40,
        listing_status: 'archived',
        source: SETTLEMENT_SOURCES.CHECKOUT_SETTLEMENT,
      }),
    /LISTING_ARCHIVED_IS_NOT_SOLD/,
  );
  assert.throws(
    () =>
      buildSaleCompletedEvent({
        listing_id: 'listing-1',
        final_price: 40,
        source: 'SEED_FILE',
      }),
    /SALE_COMPLETED_INVALID_SOURCE/,
  );

  const event = buildSaleCompletedEvent({
    listing_id: 'listing-42',
    final_price: 42.5,
    currency: 'USD',
    completed_at: '2026-07-20T12:00:00.000Z',
    source: SETTLEMENT_SOURCES.CHECKOUT_SETTLEMENT,
    artist: 'Kenny Dorham',
    title: 'Una Mas',
    catalog_number: 'BST-84127',
  });
  assert.equal(event.event_type, SALE_COMPLETED_EVENT_TYPE);
  assert.equal(event.settlement_source, 'CHECKOUT_SETTLEMENT');
  assert.ok(event.sale_event_id);
  assert.ok(isSettlementSaleCompleted(event));
  assert.equal(isSettlementSaleCompleted({ event_type: 'COMPLETED_SALE' }), false);
});

test('persistSaleCompletedEvent attaches immutable evidence snapshot', () => {
  resetSaleCompletedStoreForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-sale-'));
  const storePath = path.join(dir, 'events.json');
  const record = persistSaleCompletedEvent(
    {
      listing_id: 'listing-snap-1',
      final_price: 39,
      currency: 'USD',
      completed_at: '2026-07-20T15:00:00.000Z',
      source: SETTLEMENT_SOURCES.AUCTION_PAYMENT_SETTLEMENT,
      artist: 'Miles Davis',
      title: 'Kind of Blue',
    },
    { storePath },
  );
  assert.equal(record.immutable, true);
  assert.ok(record.evidence_snapshot_id);
  assert.ok(record.evidence_snapshot_hash);
  assert.ok(record.payload_hash);
  const listed = listSaleCompletedEvents({ listingId: 'listing-snap-1', storePath });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].event_type, 'SALE_COMPLETED');

  const snap = buildEvidenceSnapshot({
    capability: 'valuation',
    evidence_items: [
      {
        evidence_id: `sale:${record.sale_event_id}`,
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        included: true,
      },
    ],
  });
  assert.equal(snap.sold_comparables.length, 1);
  assert.equal(snap.sold_comparables[0].event_type, 'SALE_COMPLETED');
});

test('live seed COMPLETED_SALE merge is blocked without synthetic hook', () => {
  resetSaleCompletedStoreForTests();
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  const merged = mergeOwnerProofCompletedSaleCandidates({
    subject: { artist: 'Kenny Dorham', title: 'Una Mas', catalog_number: 'BST-84127' },
    candidates: [],
  });
  assert.equal(merged._completed_sale_seed_merged, 0);
  assert.equal(merged._completed_sale_seed_blocked, true);
  assert.equal(merged.candidates.length, 0);
});

test('force_sold_floor is unreachable without synthetic hook', () => {
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  assert.throws(
    () =>
      analyzeScarcity({
        subject: { artist: 'Kenny Dorham', title: 'Una Mas' },
        candidates: [],
        force_sold_floor: true,
      }),
    /SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED/,
  );
  assert.throws(
    () =>
      analyzeValuation({
        subject: { artist: 'Kenny Dorham', title: 'Una Mas' },
        candidates: [],
        force_sold_floor: true,
      }),
    /SYNTHETIC_COMPLETED_SALE_PATH_BLOCKED/,
  );
});

test('settlement SALE_COMPLETED merges into engine candidates without seed', () => {
  resetSaleCompletedStoreForTests();
  delete process.env.PHASE34_ALLOW_SYNTHETIC_SALES;
  delete process.env.PHASE34_UNIT_TEST_HOOKS;
  persistSaleCompletedEvent({
    listing_id: 'listing-kenny-1',
    final_price: 40.75,
    currency: 'USD',
    completed_at: '2026-07-18T12:00:00.000Z',
    source: SETTLEMENT_SOURCES.CHECKOUT_SETTLEMENT,
    artist: 'Kenny Dorham',
    title: 'Una Mas',
    catalog_number: 'BST-84127',
  });
  const merged = mergeOwnerProofCompletedSaleCandidates({
    subject: { artist: 'Kenny Dorham', title: 'Una Mas', catalog_number: 'BST-84127' },
    candidates: [],
  });
  assert.equal(merged._completed_sale_seed_blocked, true);
  assert.ok(merged._sale_completed_settlement_merged >= 1);
  assert.ok(merged.candidates.some((c) => c.event_type === 'SALE_COMPLETED'));
});

test('archive-as-sold floor identifier remains absent from market seed', () => {
  const seedSrc = fs.readFileSync(
    new URL('../scripts/lib/phase34-owner-proof-market-seed.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(seedSrc, /owner_listing_archived_as_sold_floor/);
  assert.doesNotMatch(seedSrc, /force_sold_floor/);
});

test('completed-sales route does not serve seed as production by default', () => {
  const routeSrc = fs.readFileSync(
    new URL('../webapp/app/api/marketplace/completed-sales/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(routeSrc, /seed_completed_sale_reachable:\s*false/);
  assert.match(routeSrc, /PHASE34_ALLOW_SYNTHETIC_SALES/);
  assert.match(routeSrc, /settlement_sale_completed/);
  assert.match(routeSrc, /SALE_COMPLETED/);
});

test('shopping checkout emitter module exists and rejects non-settlement sources conceptually', () => {
  const src = fs.readFileSync(
    new URL('../services/shopping-service/src/lib/sale-completed-emitter.ts', import.meta.url),
    'utf8',
  );
  assert.match(src, /CHECKOUT_SETTLEMENT/);
  assert.match(src, /AUCTION_PAYMENT_SETTLEMENT/);
  assert.match(src, /SALE_COMPLETED/);
  assert.match(src, /lifecycle_status = 'SOLD'/);
  assert.doesNotMatch(src, /COMPLETED_SALE/);
});
