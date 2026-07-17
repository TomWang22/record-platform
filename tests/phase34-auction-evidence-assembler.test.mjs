import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUCTION_EVIDENCE_ASSEMBLER_VERSION,
  assembleAuctionDetailEvidence,
  assembleWatchlistTemperatureEvidence,
  classifyAuctionCandidate,
  computeBidVelocityProxy,
  computeLateBidPressure,
} from '../webapp/lib/ai-auction-evidence-assembler.ts'

const NOW = Date.parse('2026-07-16T12:00:00.000Z')

const strongLot = {
  lot_id: 'lot-strong-1',
  listing_id: 'listing-strong-1',
  title: 'Art Blakey Moanin BLP-4003',
  artist: 'Art Blakey',
  catalog_number: 'BLP-4003',
  current_price: 85,
  currency: 'USD',
  bid_count: 12,
  bid_timestamps: [
    '2026-07-16T08:00:00.000Z',
    '2026-07-16T09:00:00.000Z',
    '2026-07-16T10:00:00.000Z',
    '2026-07-16T11:00:00.000Z',
  ],
  end_at: '2026-07-16T18:00:00.000Z',
  time_left_ms: 6 * 60 * 60 * 1000,
  auction_state: 'active',
  deletion_state: 'ACTIVE',
  observed_at: '2026-07-16T11:30:00.000Z',
  release_id: 'release:Art Blakey:Moanin',
  pressing_id: 'pressing:cat:BLP4003',
  authorized: true,
  sale_kind: 'asking',
}

test('assembler version is pinned', () => {
  assert.match(AUCTION_EVIDENCE_ASSEMBLER_VERSION, /phase34b-auction/)
})

test('strong active auction candidate with lineage and proxies', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: {
      lot_id: 'lot-strong-1',
      listing_id: 'listing-strong-1',
      artist: 'Art Blakey',
      title: 'Moanin',
      catalog_number: 'BLP-4003',
    },
    primary: strongLot,
    comparables: [
      {
        ...strongLot,
        lot_id: 'lot-comp-1',
        listing_id: 'listing-comp-1',
        current_price: 110,
        bid_count: 8,
        sale_kind: 'sold',
        auction_state: 'ended',
        observed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })

  assert.equal(out.analysis_mode, 'single_auction')
  assert.equal(out.auction.lot_id, 'lot-strong-1')
  assert.equal(out.auction.deletion_state, 'ACTIVE')
  assert.ok(out.auction.bid_velocity > 0)
  assert.ok(out.auction.late_bid_pressure >= 0)
  assert.equal(out.candidates.length >= 1, true)
  assert.ok(out.candidates.every((c) => c.evidence_id && c.retrieved_at && c.lineage))
  assert.ok(out.asking_count >= 1)
  assert.ok(out.sold_or_completed_count >= 1)
  assert.equal(out.request_bidder_identity, false)
  assert.equal(out.claim_collusion, false)
  assert.equal(out.claim_shill_bidding, false)
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'bidder_id'), false)
  assert.ok(!JSON.stringify(out).match(/"claim_collusion"\s*:\s*true/))
})

test('weak match is classified and kept separate from strong', () => {
  const scope = classifyAuctionCandidate(
    { artist: 'Art Blakey', title: 'Moanin', catalog_number: 'BLP-4003' },
    {
      lot_id: 'weak-1',
      title: 'Some Jazz Compilation',
      artist: 'Various',
      current_price: 20,
      bid_count: 1,
      auction_state: 'active',
      deletion_state: 'ACTIVE',
      authorized: true,
    },
  )
  assert.equal(scope, 'weak')
})

test('ambiguous pressing without catalog is labeled', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: {
      lot_id: 'lot-amb',
      artist: 'Art Blakey',
      title: 'Moanin',
      catalog_number: null,
    },
    primary: {
      ...strongLot,
      lot_id: 'lot-amb',
      catalog_number: null,
      pressing_id: null,
    },
    comparables: [],
  })
  assert.equal(out.subject.pressing_identity_confidence, 'ambiguous')
  assert.ok(out.limitations.some((l) => /ambiguous/i.test(l)))
})

test('no usable auction evidence abstains cleanly', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: { lot_id: 'missing', artist: 'X', title: 'Y' },
    primary: null,
    comparables: [],
  })
  assert.equal(out.candidates.length, 0)
  assert.equal(out.auction_count, 0)
  assert.ok(out.limitations.some((l) => /No usable/i.test(l) || /insufficient/i.test(l)))
})

test('stale auction evidence is flagged', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: { lot_id: 'lot-stale', artist: 'Art Blakey', title: 'Moanin', catalog_number: 'BLP-4003' },
    primary: {
      ...strongLot,
      lot_id: 'lot-stale',
      observed_at: '2024-01-01T00:00:00.000Z',
      end_at: '2024-01-02T00:00:00.000Z',
      time_left_ms: 0,
      auction_state: 'ended',
      sale_kind: 'sold',
    },
    comparables: [],
  })
  assert.equal(out.auction.stale, true)
  assert.ok(out.limitations.some((l) => /stale/i.test(l)))
})

test('deleted auction is excluded from candidates', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: { lot_id: 'lot-del', artist: 'Art Blakey', title: 'Moanin', catalog_number: 'BLP-4003' },
    primary: {
      ...strongLot,
      lot_id: 'lot-del',
      deletion_state: 'DELETED',
      auction_state: 'deleted',
      deleted_at: '2026-07-01T00:00:00.000Z',
    },
    comparables: [
      {
        ...strongLot,
        lot_id: 'lot-del-comp',
        deletion_state: 'DELETED',
        auction_state: 'deleted',
      },
    ],
  })
  assert.equal(out.candidates.length, 0)
  assert.equal(out.auction.deletion_state, 'DELETED')
  assert.ok(out.limitations.some((l) => /deleted/i.test(l)))
})

test('unauthorized watchlist batch produces empty auctions and unauthorized flag', () => {
  const out = assembleWatchlistTemperatureEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    watchlistOwnerPrincipalId: 'principal_buyer_b',
    lots: [strongLot, { ...strongLot, lot_id: 'lot-2', listing_id: 'listing-2' }],
  })
  assert.equal(out.analysis_mode, 'watchlist_batch')
  assert.equal(out.unauthorized_watchlist, true)
  assert.equal(out.watchlist_auctions.length, 0)
  assert.ok(out.limitations.some((l) => /unauthorized/i.test(l)))
  assert.equal(out.request_bidder_identity, false)
  assert.equal(out.claim_collusion, false)
})

test('authorized watchlist separates asking vs sold/completed and bounds size', () => {
  const lots = Array.from({ length: 40 }, (_, i) => ({
    ...strongLot,
    lot_id: `lot-${i}`,
    listing_id: `listing-${i}`,
    current_price: 40 + i,
    bid_count: i % 5 === 0 ? 0 : 2 + (i % 8),
    sale_kind: i % 3 === 0 ? 'sold' : 'asking',
    auction_state: i % 3 === 0 ? 'ended' : 'active',
    end_at: `2026-07-16T${String(10 + (i % 8)).padStart(2, '0')}:00:00.000Z`,
    observed_at: '2026-07-16T11:00:00.000Z',
  }))
  lots.push({
    ...strongLot,
    lot_id: 'lot-deleted',
    deletion_state: 'DELETED',
    auction_state: 'deleted',
  })
  lots.push({
    ...strongLot,
    lot_id: 'lot-stale',
    observed_at: '2024-01-01T00:00:00.000Z',
    sale_kind: 'sold',
    auction_state: 'ended',
  })

  const out = assembleWatchlistTemperatureEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    watchlistOwnerPrincipalId: 'principal_buyer_a',
    lots,
    maxLots: 25,
  })

  assert.equal(out.unauthorized_watchlist, false)
  assert.ok(out.watchlist_auctions.length <= 25)
  assert.ok(out.watchlist_auctions.every((a) => a.deletion_state === 'ACTIVE'))
  assert.ok(out.asking_count >= 1)
  assert.ok(out.sold_or_completed_count >= 1)
  assert.ok(out.candidates.every((c) => c.sale_kind === 'asking' || c.sale_kind === 'sold' || c.sale_kind === 'completed'))
  assert.ok(out.ending_concentration.length >= 1)
  assert.ok(Array.isArray(out.underpriced_candidates))
  assert.ok(Array.isArray(out.overheated_candidates))
  assert.ok(out.limitations.some((l) => /bounded|truncated|cap/i.test(l)) || out.watchlist_auctions.length === 25)
})

test('bid velocity and late-bid pressure are bounded proxies', () => {
  const velocity = computeBidVelocityProxy({
    bid_count: 10,
    bid_timestamps: [
      '2026-07-16T10:00:00.000Z',
      '2026-07-16T10:30:00.000Z',
      '2026-07-16T11:00:00.000Z',
      '2026-07-16T11:30:00.000Z',
    ],
    nowMs: NOW,
    windowHours: 6,
  })
  assert.ok(velocity >= 0)
  assert.ok(velocity <= 20)

  const late = computeLateBidPressure({
    bid_count: 8,
    time_left_ms: 30 * 60 * 1000,
    bid_velocity: velocity,
  })
  assert.ok(late >= 0)
  assert.ok(late <= 1)
})

test('never emits bidder identity fields from masked high bidder input', () => {
  const out = assembleAuctionDetailEvidence({
    nowMs: NOW,
    principalId: 'principal_buyer_a',
    subject: { lot_id: 'lot-mask', artist: 'Art Blakey', title: 'Moanin', catalog_number: 'BLP-4003' },
    primary: {
      ...strongLot,
      lot_id: 'lot-mask',
      high_bidder_masked: 'b***42',
      winner_masked: 'w***99',
    },
    comparables: [],
  })
  const blob = JSON.stringify(out)
  assert.equal(blob.includes('b***42'), false)
  assert.equal(blob.includes('w***99'), false)
  assert.equal(blob.includes('high_bidder'), false)
  assert.equal(out.request_bidder_identity, false)
})
