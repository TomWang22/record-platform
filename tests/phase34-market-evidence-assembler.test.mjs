import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assembleScarcityEvidence,
  assembleValuationEvidence,
  classifyListingMatch,
  normalizeCatalog,
  pressingIdForRecord,
} from '../webapp/lib/ai-market-evidence-assembler.ts'

const NOW = Date.parse('2026-07-16T12:00:00.000Z')

const baseRecord = {
  id: 'rec-exact-1',
  artist: 'Art Blakey',
  name: 'Moanin',
  format: 'LP',
  catalogNumber: 'BLP-4003',
  label: 'Blue Note',
  releaseYear: 1958,
  pressingYear: 1958,
  recordGrade: 'VG+',
}

test('normalizeCatalog strips punctuation', () => {
  assert.equal(normalizeCatalog('BLP-4003'), 'BLP4003')
  assert.equal(normalizeCatalog(' blp 4003 '), 'BLP4003')
})

test('exact pressing identity when catalog present', () => {
  const p = pressingIdForRecord(baseRecord)
  assert.equal(p.confidence, 'exact')
  assert.match(p.pressing_id, /pressing:cat:BLP4003/)
})

test('pressing ambiguous without catalog', () => {
  const p = pressingIdForRecord({
    ...baseRecord,
    catalogNumber: null,
  })
  assert.equal(p.confidence, 'ambiguous')
})

test('exact pressing with strong evidence', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'L1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 120,
        currency: 'USD',
        status: 'active',
        mediaCondition: 'VG+',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'L2',
        title: 'Art Blakey Moanin',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 135,
        currency: 'USD',
        status: 'active',
        listed_at: '2026-05-01T00:00:00.000Z',
      },
    ],
    ownerListings: [
      {
        id: 'S1',
        title: 'Art Blakey Moanin sold',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 110,
        currency: 'USD',
        status: 'sold',
        sold_at: '2026-04-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.claim_rarity_from_zero_results, false)
  assert.equal(out.subject.pressing_identity_confidence, 'exact')
  assert.ok(out.pressing_candidates.length >= 2)
  assert.equal(out.asking_count, 2)
  assert.equal(out.sold_count, 1)
  assert.ok(out.candidates.every((c) => c.evidence_id && !c.evidence_id.includes('undefined')))
})

test('release known but pressing ambiguous', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: { ...baseRecord, catalogNumber: null },
    activeListings: [
      {
        id: 'L1',
        title: 'Art Blakey Moanin LP',
        artist: 'Art Blakey',
        price: 80,
        status: 'active',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.subject.pressing_identity_confidence, 'ambiguous')
  assert.equal(out.require_exact_pressing, false)
  assert.ok(out.limitations.some((l) => /ambiguous/i.test(l)))
  assert.equal(out.release_candidates.length, 1)
  assert.equal(out.pressing_candidates.length, 0)
})

test('common release with zero current listings never claims rarity from empty inventory', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [],
    ownerListings: [],
    auctionResults: [],
  })
  assert.equal(out.claim_rarity_from_zero_results, false)
  assert.equal(out.candidates.length, 0)
  assert.equal(out.active_supply_count, 0)
  assert.ok(out.limitations.some((l) => /No live comparable/i.test(l)))
})

test('genuinely scarce exact pressing still separates sold vs asking', () => {
  const out = assembleValuationEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'ASK1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 450,
        status: 'active',
        listed_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    ownerListings: [
      {
        id: 'SOLD1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 380,
        status: 'sold',
        sold_at: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'SOLD2',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 400,
        status: 'sold',
        sold_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.asking_count, 1)
  assert.equal(out.sold_count, 2)
  assert.equal(out.min_sold_comps, 2)
  assert.ok(out.candidates.some((c) => c.sale_kind === 'asking'))
  assert.ok(out.candidates.some((c) => c.sale_kind === 'sold'))
})

test('stale evidence is flagged', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'OLD1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 90,
        status: 'active',
        listed_at: '2024-01-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.candidates.length, 1)
  assert.equal(out.candidates[0].stale, true)
  assert.ok(out.limitations.some((l) => /Stale evidence/i.test(l)))
})

test('deleted evidence is excluded', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'DEL1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 90,
        status: 'active',
        deleted_at: '2026-07-01T00:00:00.000Z',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
    ownerListings: [
      {
        id: 'DEL2',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 95,
        status: 'deleted',
        sold_at: '2026-05-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.candidates.length, 0)
  assert.ok(out.limitations.some((l) => /Excluded .* deleted/i.test(l)))
})

test('wrong pressing is excluded', () => {
  assert.equal(
    classifyListingMatch(baseRecord, {
      id: 'W1',
      title: 'Art Blakey Moanin',
      artist: 'Art Blakey',
      catalogNumber: 'BLP-1500',
      price: 50,
      status: 'active',
    }),
    'wrong_pressing',
  )
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'W1',
        title: 'Art Blakey Moanin',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-1500',
        price: 50,
        status: 'active',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.candidates.length, 0)
})

test('missing catalog number does not invent exact pressing matches', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: { ...baseRecord, catalogNumber: null },
    activeListings: [
      {
        id: 'L1',
        title: 'Art Blakey Moanin',
        artist: 'Art Blakey',
        price: 70,
        status: 'active',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.subject.pressing_identity_confidence, 'ambiguous')
  assert.ok(out.candidates.every((c) => c.match_scope === 'release'))
  assert.ok(out.candidates.every((c) => c.pressing_id == null))
})

test('bootleg/counterfeit warning', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'B1',
        title: 'Art Blakey Moanin bootleg reissue',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 40,
        status: 'active',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  assert.ok(out.limitations.some((l) => /Bootleg\/counterfeit/i.test(l)))
})

test('no evidence path', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
  })
  assert.equal(out.candidates.length, 0)
  assert.equal(out.asking_count, 0)
  assert.equal(out.sold_count, 0)
  assert.equal(out.claim_rarity_from_zero_results, false)
})

test('archived listing is not treated as a completed sale', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    ownerListings: [
      {
        id: 'ARCH1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 110,
        currency: 'USD',
        status: 'archived',
        sold_at: '2026-04-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.sold_count, 0)
  assert.equal(out.asking_count, 0)
  assert.equal(out.candidates.length, 0)
})

test('pre-seeded COMPLETED_SALE events become sold comps with source_type sale', () => {
  const out = assembleValuationEvidence({
    nowMs: NOW,
    record: baseRecord,
    activeListings: [
      {
        id: 'ASK1',
        title: 'Art Blakey Moanin BLP-4003',
        artist: 'Art Blakey',
        catalogNumber: 'BLP-4003',
        price: 450,
        status: 'active',
        listed_at: '2026-07-01T00:00:00.000Z',
      },
    ],
    completedSaleEvents: [
      {
        market_event_id: 'me-1',
        source_listing_id: 'SRC1',
        event_type: 'COMPLETED_SALE',
        artist: 'Art Blakey',
        title: 'Moanin',
        catalog_number: 'BLP-4003',
        price_normalized: 380,
        currency_normalized: 'USD',
        sold_at: '2026-03-01T00:00:00.000Z',
      },
      {
        market_event_id: 'me-2',
        source_listing_id: 'SRC2',
        event_type: 'COMPLETED_SALE',
        artist: 'Art Blakey',
        title: 'Moanin',
        catalog_number: 'BLP-4003',
        price_normalized: 400,
        currency_normalized: 'USD',
        sold_at: '2026-02-01T00:00:00.000Z',
      },
      {
        market_event_id: 'me-3',
        source_listing_id: 'SRC3',
        event_type: 'COMPLETED_SALE',
        artist: 'Art Blakey',
        title: 'Moanin',
        catalog_number: 'BLP-4003',
        price_normalized: 390,
        currency_normalized: 'USD',
        sold_at: '2026-01-15T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.asking_count, 1)
  assert.equal(out.sold_count, 3)
  assert.ok(out.candidates.every((c) => c.sale_kind !== 'sold' || c.source_type === 'sale'))
  assert.ok(out.evidence_sources.includes('authorized_completed_sale_events'))
})

test('source_record_id exact pressing and owner_private scope', () => {
  const out = assembleScarcityEvidence({
    nowMs: NOW,
    record: baseRecord,
    ownerListings: [
      {
        id: 'OWN1',
        title: 'My copy',
        artist: 'Art Blakey',
        price: 99,
        status: 'active',
        source_record_id: 'rec-exact-1',
        listed_at: '2026-06-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(out.pressing_candidates.length, 1)
  assert.equal(out.candidates[0].privacy_class, 'OWNER_PRIVATE')
  assert.equal(out.candidates[0].authorization_scope, 'owner_private')
})
