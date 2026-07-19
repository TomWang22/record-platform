/**
 * Phase 34 market-event normalization, pressing resolution, evidence snapshot,
 * and claim-support fail-closed coverage.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NORMALIZATION_VERSION,
  REQUIRED_EXCLUSIONS,
  normalizeMarketEvent,
  excludeEvent,
  collectExclusionReasons,
  validateHardDistinctions,
  buildEvidenceItem,
  stripMeta,
} from '../scripts/lib/phase34-market-event-normalization.mjs';
import {
  resolvePressing,
  mayClaimExactPressing,
  ADVERSARIAL_PRESSING_FIXTURES,
  listAdversarialPressingFixtureIds,
  runAdversarialPressingFixture,
  RESOLUTION_STATUSES,
} from '../scripts/lib/phase34-pressing-resolution.mjs';
import {
  buildEvidenceSnapshot,
  mapClaimsToEvidence,
  assertNoUnsupportedMaterialClaims,
} from '../scripts/lib/phase34-evidence-snapshot.mjs';
import {
  buildDataQualityReport,
  writeDataQualityReports,
} from '../scripts/lib/phase34-data-quality-report.mjs';

test('normalization version and content_hash are stable', () => {
  const a = normalizeMarketEvent({
    source_id: 'src-1',
    source_event_id: 'evt-1',
    event_type: 'COMPLETED_SALE',
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    currency_original: 'USD',
    price_original: 40,
    ingested_at: '2026-07-01T00:00:00.000Z',
  });
  const b = normalizeMarketEvent({
    source_id: 'src-1',
    source_event_id: 'evt-1',
    event_type: 'COMPLETED_SALE',
    artist: 'Miles Davis',
    title: 'Kind of Blue',
    currency_original: 'USD',
    price_original: 40,
    ingested_at: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(a.normalization_version, NORMALIZATION_VERSION);
  assert.equal(a.normalization_version, 'phase34-market-event-v1');
  assert.equal(a.content_hash, b.content_hash);
  assert.match(a.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(a.event_type, 'COMPLETED_SALE');
  assert.equal(a.price_normalized, 40);
});

test('hard distinction: never treat asking as sold', () => {
  const e = normalizeMarketEvent({
    source_id: 'src-ask',
    source_event_id: 'ask-1',
    source_type: 'asking',
    listed_as: 'sold',
    asking_presented_as_sold: true,
    price: 55,
    currency: 'USD',
  });
  assert.equal(e.event_type, 'ASKING_LISTING');
  assert.equal(e.event_status, 'ACTIVE');
  assert.equal(e.sold_at, null);
  assert.equal(e._meta.asking_as_sold_blocked, true);

  assert.throws(
    () =>
      validateHardDistinctions([
        {
          ...stripMeta(e),
          treated_as_sold: true,
          sold_at: '2026-06-01T00:00:00.000Z',
        },
      ]),
    /HARD_DISTINCTION_VIOLATIONS/,
  );
});

test('hard distinction: never treat active as completed', () => {
  const e = normalizeMarketEvent({
    source_id: 'src-act',
    source_event_id: 'act-1',
    event_type: 'ASKING_LISTING',
    event_status: 'COMPLETED',
  });
  assert.equal(e.event_status, 'ACTIVE');
  assert.equal(e._meta.active_as_completed_blocked, true);

  assert.throws(
    () =>
      validateHardDistinctions([
        {
          market_event_id: 'bad-active',
          source_id: 's',
          source_event_id: 'e',
          event_type: 'ASKING_LISTING',
          event_status: 'ACTIVE',
          treated_as_completed: true,
          content_hash: 'x'.repeat(64),
          normalization_version: NORMALIZATION_VERSION,
        },
      ]),
    /ACTIVE_AS_COMPLETED|HARD_DISTINCTION/,
  );
});

test('hard distinction: ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE does not invent price', () => {
  const e = normalizeMarketEvent({
    source_id: 'src-offer',
    source_event_id: 'off-1',
    event_type: 'OFFER_ACCEPTED',
    sale_type: 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE',
    price: 99,
    currency: 'USD',
    invent_price: true,
    price_is_invented: true,
  });
  assert.equal(e.sale_type, 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE');
  assert.equal(e.price_original, null);
  assert.equal(e.price_normalized, null);

  assert.throws(
    () =>
      validateHardDistinctions([
        {
          market_event_id: 'bad-offer',
          source_id: 's',
          source_event_id: 'e',
          event_type: 'OFFER_ACCEPTED',
          event_status: 'COMPLETED',
          sale_type: 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE',
          price_original: 50,
          content_hash: 'y'.repeat(64),
          normalization_version: NORMALIZATION_VERSION,
        },
      ]),
    /UNKNOWN_OFFER_PRICE|HARD_DISTINCTION/,
  );
});

test('hard distinction: RELEASE_LEVEL_MATCH != EXACT_PRESSING_MATCH', () => {
  const e = normalizeMarketEvent({
    source_id: 'src-pr',
    source_event_id: 'pr-1',
    event_type: 'COMPLETED_SALE',
    pressing_match_confidence: 'EXACT_PRESSING_MATCH',
    release_level_only: true,
    identity_resolution_status: 'RELEASE_LEVEL_ONLY',
  });
  assert.equal(e.pressing_match_confidence, 'RELEASE_LEVEL_MATCH');

  assert.throws(
    () =>
      validateHardDistinctions([
        {
          market_event_id: 'bad-pr',
          source_id: 's',
          source_event_id: 'e',
          event_type: 'COMPLETED_SALE',
          event_status: 'COMPLETED',
          pressing_match_confidence: 'EXACT_PRESSING_MATCH',
          identity_resolution_status: 'RELEASE_LEVEL_ONLY',
          release_level_only: true,
          content_hash: 'z'.repeat(64),
          normalization_version: NORMALIZATION_VERSION,
        },
      ]),
    /RELEASE_LEVEL_AS_EXACT|HARD_DISTINCTION/,
  );
});

test('REQUIRED_EXCLUSIONS list is complete and excludeEvent applies them', () => {
  const expected = [
    'deleted',
    'expired',
    'unauthorized',
    'cross-user',
    'cross-thread',
    'wrong pressing',
    'wrong currency without conversion',
    'asking used as sold',
    'active used as completed',
    'unknown accepted-offer price',
    'duplicate event',
    'stale beyond policy',
    'source rights unavailable',
  ];
  assert.deepEqual([...REQUIRED_EXCLUSIONS], expected);

  const base = normalizeMarketEvent({
    source_id: 'src-ex',
    source_event_id: 'ex-1',
    event_type: 'COMPLETED_SALE',
    currency_original: 'USD',
    price_original: 10,
  });

  assert.equal(excludeEvent({ ...base, deletion_status: 'DELETED' }).included, false);
  assert.match(excludeEvent({ ...base, deletion_status: 'DELETED' }).excluded_reason, /deleted/);

  assert.equal(excludeEvent({ ...base, event_type: 'SOURCE_EXPIRED' }).included, false);
  assert.equal(
    excludeEvent({ ...base, privacy_class: 'PROHIBITED' }, [], {
      authorized_scopes: ['public_market'],
    }).included,
    false,
  );
  assert.equal(
    excludeEvent(
      { ...base, owner_principal_id: 'other' },
      [],
      { principal_id: 'me' },
    ).included,
    false,
  );
  assert.equal(
    excludeEvent(
      { ...base, thread_id: 't2' },
      [],
      { thread_id: 't1' },
    ).included,
    false,
  );
  assert.equal(
    excludeEvent(
      { ...base, pressing_id: 'p-wrong' },
      [],
      { subject_pressing_id: 'p-right' },
    ).included,
    false,
  );

  const badFx = normalizeMarketEvent({
    source_id: 'src-fx',
    source_event_id: 'fx-1',
    event_type: 'COMPLETED_SALE',
    currency_original: 'XYZ',
    price_original: 10,
  });
  assert.equal(excludeEvent(badFx).included, false);
  assert.match(excludeEvent(badFx).excluded_reason, /wrong currency/);

  assert.equal(
    excludeEvent({ ...base, asking_presented_as_sold: true }).included,
    false,
  );
  assert.equal(
    excludeEvent({ ...base, event_status: 'ACTIVE', treated_as_completed: true }).included,
    false,
  );
  assert.equal(
    excludeEvent({
      ...base,
      sale_type: 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE',
      price_original: 12,
    }).included,
    false,
  );
  assert.equal(
    excludeEvent(base, [], {
      seen_content_hashes: new Set([base.content_hash]),
    }).included,
    false,
  );
  assert.equal(
    excludeEvent({ ...base, staleness_status: 'STALE' }).included,
    false,
  );
  assert.equal(
    excludeEvent({ ...base, rights_status: 'UNAVAILABLE' }).included,
    false,
  );

  const reasons = collectExclusionReasons({ ...base, deletion_status: 'DELETED' });
  assert.ok(reasons.includes('deleted'));
});

test('buildEvidenceItem projects provenance fields', () => {
  const e = normalizeMarketEvent({
    source_id: 'src-ev',
    source_event_id: 'ev-1',
    event_type: 'COMPLETED_SALE',
    currency_original: 'USD',
    price_original: 20,
    rights_status: 'AVAILABLE',
    authorization_scope: 'authenticated_market',
    pressing_match_confidence: 'EXACT_PRESSING_MATCH',
    identity_resolution_status: 'EXACT',
  });
  const item = buildEvidenceItem(e);
  assert.ok(item.evidence_id);
  assert.equal(item.source_id, 'src-ev');
  assert.equal(item.rights_status, 'AVAILABLE');
  assert.equal(item.source_event_id, 'ev-1');
  assert.equal(item.content_hash, e.content_hash);
  assert.equal(item.identity_status, 'EXACT');
  assert.equal(item.pressing_confidence, 'EXACT_PRESSING_MATCH');
  assert.equal(item.authorization_scope, 'authenticated_market');
  assert.equal(item.included, true);
  assert.equal(item.excluded_reason, null);
});

test('pressing adversarial fixtures cover required confusion cases', () => {
  const ids = listAdversarialPressingFixtureIds();
  for (const required of [
    'us_mono_vs_jp',
    'original_vs_reissue',
    'promo_vs_stock',
    'picture_disc_vs_black',
    'catalog_reuse',
    'label_variation',
    'matrix_mismatch',
    'wrong_country',
    'unknown_pressing',
  ]) {
    assert.ok(ids.includes(required), `missing fixture ${required}`);
  }

  for (const id of ids) {
    const { fixture, resolution } = runAdversarialPressingFixture(id);
    assert.ok(RESOLUTION_STATUSES.includes(resolution.resolution_status));
    assert.equal(resolution.resolution_status, fixture.expected_status, id);
    assert.equal(resolution.resolved_pressing_id, fixture.expected_pressing_id, id);
  }

  const exact = resolvePressing({
    subject: ADVERSARIAL_PRESSING_FIXTURES.us_mono_vs_jp.subject,
    candidates: ADVERSARIAL_PRESSING_FIXTURES.us_mono_vs_jp.candidates,
  });
  assert.equal(mayClaimExactPressing(exact), true);

  const releaseOnly = resolvePressing({
    subject: { artist: 'X', title: 'Y' },
    candidates: [],
  });
  assert.equal(releaseOnly.resolution_status, 'RELEASE_LEVEL_ONLY');
  assert.equal(mayClaimExactPressing(releaseOnly), false);

  const probableUndocumented = {
    resolution_status: 'PROBABLE',
    high_confidence_probable_documented: false,
    limitations: [],
  };
  assert.equal(mayClaimExactPressing(probableUndocumented), false);

  const probableDocumented = {
    resolution_status: 'PROBABLE',
    high_confidence_probable_documented: true,
    limitations: ['documented high-confidence PROBABLE'],
  };
  assert.equal(mayClaimExactPressing(probableDocumented), true);
});

test('claim support fail-closed for unsupported material claims', () => {
  const sold = buildEvidenceItem(
    normalizeMarketEvent({
      source_id: 'mkt',
      source_event_id: 'sold-1',
      event_type: 'COMPLETED_SALE',
      currency_original: 'USD',
      price_original: 42,
      pressing_match_confidence: 'EXACT_PRESSING_MATCH',
      identity_resolution_status: 'EXACT',
    }),
  );
  sold.event_type = 'COMPLETED_SALE';
  sold.sale_kind = 'sold';

  const snapshot = buildEvidenceSnapshot({
    capability: 'valuation',
    subject: { pressing_id: 'p1' },
    participant_side: 'buyer',
    authorized_scope: 'authenticated_market',
    evidence_items: [sold],
    metrics: { median_sold: 42, sold_count: 1 },
    limitations: [],
  });

  assert.ok(snapshot.evidence_snapshot_id);
  assert.ok(snapshot.evidence_snapshot_hash);
  assert.equal(snapshot.sold_comparables.length, 1);

  const supported = mapClaimsToEvidence(
    [
      {
        claim_id: 'c1',
        claim_text: 'Median sold is $42',
        claim_type: 'valuation',
        evidence_ids: [sold.evidence_id],
        deterministic_metric_ids: ['median_sold'],
      },
    ],
    snapshot,
  );
  assert.equal(supported[0].support_status, 'SUPPORTED');
  assert.doesNotThrow(() => assertNoUnsupportedMaterialClaims(supported));

  const unsupported = mapClaimsToEvidence(
    [
      {
        claim_id: 'c-bad',
        claim_text: 'This pressing sold for $999',
        claim_type: 'price',
        evidence_ids: [],
        deterministic_metric_ids: [],
      },
    ],
    snapshot,
  );
  assert.equal(unsupported[0].support_status, 'UNSUPPORTED');
  assert.throws(
    () => assertNoUnsupportedMaterialClaims(unsupported),
    /UNSUPPORTED_MATERIAL_CLAIMS/,
  );

  const contradicted = mapClaimsToEvidence(
    [
      {
        claim_id: 'c-con',
        claim_text: 'Uses excluded evidence',
        claim_type: 'financial',
        evidence_ids: ['ev-excluded'],
        support_status: 'CONTRADICTED',
      },
    ],
    {
      ...snapshot,
      excluded_evidence: [{ evidence_id: 'ev-excluded', included: false }],
    },
  );
  assert.equal(contradicted[0].support_status, 'CONTRADICTED');
  assert.throws(
    () => assertNoUnsupportedMaterialClaims(contradicted),
    /UNSUPPORTED_MATERIAL_CLAIMS/,
  );
});

test('data quality report PASS when hard violations are zero and writes files', () => {
  const events = [
    normalizeMarketEvent({
      source_id: 'dq',
      source_event_id: '1',
      event_type: 'COMPLETED_SALE',
      currency_original: 'USD',
      price_original: 30,
      rights_status: 'AVAILABLE',
    }),
    normalizeMarketEvent({
      source_id: 'dq',
      source_event_id: '2',
      event_type: 'ASKING_LISTING',
      currency_original: 'USD',
      price_original: 45,
      rights_status: 'AVAILABLE',
    }),
  ];
  const resolutions = [
    resolvePressing({
      subject: ADVERSARIAL_PRESSING_FIXTURES.us_mono_vs_jp.subject,
      candidates: ADVERSARIAL_PRESSING_FIXTURES.us_mono_vs_jp.candidates,
    }),
  ];
  const exclusions = events.map((e) => excludeEvent(e));
  const report = buildDataQualityReport({ events, exclusions, resolutions });
  assert.equal(report.metrics.asking_as_sold_violations, 0);
  assert.equal(report.metrics.active_as_completed_violations, 0);
  assert.equal(report.metrics.evidence_snapshot_reproducibility, 1);
  assert.equal(report.verdict, 'PASS');
  assert.ok('events_ingested' in report.metrics);
  assert.ok('exact_pressing_rate' in report.metrics);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-dq-'));
  const written = writeDataQualityReports(tmp, { events, exclusions, resolutions });
  assert.ok(fs.existsSync(written.jsonPath));
  assert.ok(fs.existsSync(written.htmlPath));
  assert.equal(path.basename(written.jsonPath), 'data-quality-report.json');
  assert.equal(path.basename(written.htmlPath), 'data-quality-report.html');
  const parsed = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'));
  assert.equal(parsed.verdict, 'PASS');
});

test('validateHardDistinctions passes clean normalized set', () => {
  const events = [
    normalizeMarketEvent({
      source_id: 'ok',
      source_event_id: '1',
      event_type: 'COMPLETED_SALE',
      currency_original: 'USD',
      price_original: 10,
    }),
    normalizeMarketEvent({
      source_id: 'ok',
      source_event_id: '2',
      event_type: 'ASKING_LISTING',
      currency_original: 'USD',
      price_original: 12,
    }),
  ].map(stripMeta);
  assert.equal(validateHardDistinctions(events), true);
});
