/**
 * Phase 34 owner-proof PRODUCT remediation — unit tests for the visual defects
 * ledger, the shared product-contracts module, customer-copy sanitization,
 * and the engine-level honesty fixes (zero-sold scarcity abstention, screenshot
 * distinctness for evidence/limitations disclosures).
 *
 * Does not touch /tmp/phase34-owner-proof-live-recapture-v3 or the frozen
 * owner-review-artifacts/phase34/owner-proof-live-v3 export — everything here
 * is either a pure function call or a read-only source/JSON inspection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORBIDDEN_OWNER_FACING_PATTERNS,
  assertNoForbiddenOwnerFacingText,
  SUCCESS_DATA_FLOORS,
  assertSuccessScenarioDataFloor,
  translateInternalCode,
  assertCapabilityResponseStructure,
  MIN_RESPONSE_WORD_TARGETS,
  SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE,
} from '../scripts/lib/phase34-owner-proof-product-contracts.mjs';
import { analyzeScarcity } from '../scripts/lib/phase33c-scarcity.mjs';
import { DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE } from '../scripts/lib/phase34-product-screenshot-distinctness.mjs';
import { DISCLOSURE_DID_NOT_EXPAND } from '../scripts/lib/phase34-product-journeys/adapters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const DEFECTS_PATH = path.join(REPO, 'scripts/ai-platform/phase34-owner-proof-v3-visual-defects.json');
const SCENARIOS_PATH = path.join(REPO, 'scripts/ai-platform/phase34-owner-proof-scenarios.json');
const SEED_MANIFEST_PATH = path.join(REPO, 'scripts/ai-platform/phase34-owner-proof-seed-manifest.json');
const CUSTOMER_COPY_TS_PATH = path.join(REPO, 'webapp/lib/ai-customer-copy.ts');
const PANEL_SHELL_TSX_PATH = path.join(
  REPO,
  'webapp/components/ai/intelligence/intelligence-panel-shell.tsx',
);
const AUCTION_PANEL_TSX_PATH = path.join(
  REPO,
  'webapp/components/ai/intelligence/auction-intelligence-panel.tsx',
);
const RECS_PANEL_TSX_PATH = path.join(
  REPO,
  'webapp/components/ai/intelligence/recommendations-intelligence-panel.tsx',
);

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readSrc(p) {
  return fs.readFileSync(p, 'utf8');
}

// Theme 1: defects ledger exists with the required schema version + counts.
test('defects ledger has required schema version and row counts', () => {
  const doc = loadJson(DEFECTS_PATH);
  assert.equal(doc.schema_version, 'phase34-owner-proof-v3-visual-defects-v1');
  assert.equal(doc.image_row_count, 20);
  assert.equal(doc.scenario_row_count, 24);
  const imageRows = doc.rows.filter((r) => r.image_name);
  assert.equal(imageRows.length, 20);
  assert.equal(doc.rows.length, 44);
});

// Theme 2: defects ledger covers every scenario_id from the 24-scenario registry.
test('defects ledger covers all 24 executable scenario_ids', () => {
  const doc = loadJson(DEFECTS_PATH);
  const scenarios = loadJson(SCENARIOS_PATH).scenarios;
  assert.equal(scenarios.length, 24);
  const idsInLedger = new Set(doc.rows.map((r) => r.scenario_id));
  for (const s of scenarios) {
    assert.ok(idsInLedger.has(s.scenario_id), `missing ledger row for ${s.scenario_id}`);
  }
});

// Theme 3: defects ledger records every required defect code at least once.
test('defects ledger records every required defect code', () => {
  const doc = loadJson(DEFECTS_PATH);
  const observed = new Set(doc.rows.flatMap((r) => r.required_repairs || []));
  const required = [
    'SCARCITY_SUCCESS_WITH_ZERO_SOLD',
    'SCARCITY_EXACT_VS_RELEASE_NOT_ANSWERED',
    'SCARCITY_ASKING_INVENTORY_OVERWEIGHTED',
    'VALUATION_SUCCESS_RETURNED_ABSTENTION',
    'VALUATION_ZERO_SOLD_COMPARABLES',
    'VALUATION_WRONG_SCARCITY_RARITY_COPY',
    'VALUATION_RANGES_ABSENT',
    'AUCTION_SUCCESS_DATA_FLOOR_NOT_MET',
    'AUCTION_WATCHLIST_REPORT_ABSENT',
    'AUCTION_INTERNAL_CODES_VISIBLE',
    'AUCTION_SINGLE_LOT_MASQUERADING_AS_WATCHLIST_ANALYSIS',
    'EMBEDDING_STALE_FIELDS_DID_NOT_CHANGE',
    'EMBEDDING_CORRECTION_TEXT_ONLY',
    'SEARCH_PRICE_CONSTRAINT_NOT_PROVEN',
    'SEARCH_PRESSING_MATCH_REASON_ABSENT',
    'SEARCH_RESULT_CARDS_ABSENT',
    'NEGOTIATION_SYNTHETIC_EVIDENCE_IDS_VISIBLE',
    'NEGOTIATION_DRAFT_COPY_TOO_MECHANICAL',
    'NEGOTIATION_CURRENCY_COPY_UNNATURAL',
    'RECOMMENDATION_PRICE_FIELDS_ABSENT',
    'RECOMMENDATION_ARTIST_FIELDS_ABSENT',
    'RECOMMENDATION_AVAILABILITY_ABSENT',
    'RECOMMENDATION_INTERNAL_REASON_CODES_VISIBLE',
    'RECOMMENDATION_DIVERSITY_NOT_PROVEN',
    'ANALYTICS_QUESTION_NOT_ANSWERED',
    'ANALYTICS_RAW_VALUES_WITHOUT_ANALYSIS',
    'ANALYTICS_TREND_METRICS_ABSENT',
    'ANALYTICS_VISUALIZATION_ABSENT',
    'OWNER_FACING_E2E_IDENTIFIER_VISIBLE',
    'OWNER_FACING_SEED_IDENTIFIER_VISIBLE',
    'OWNER_FACING_FIXTURE_IDENTIFIER_VISIBLE',
    'OWNER_FACING_PLACEHOLDER_ARTWORK',
    'GENERIC_DIAGNOSTIC_PANEL_PRESENTATION',
    'DUPLICATE_EVIDENCE_LIMITATIONS_SCREENSHOT',
  ];
  for (const code of required) {
    assert.ok(observed.has(code), `defects ledger never records ${code}`);
  }
});

// Theme 4: every row is either BLOCKED or PARTIAL, and honest-limit rows are PARTIAL.
test('acceptance_status is BLOCKED for product defects and PARTIAL for honest-limit rows', () => {
  const doc = loadJson(DEFECTS_PATH);
  for (const row of doc.rows) {
    assert.ok(
      row.acceptance_status === 'BLOCKED' || row.acceptance_status === 'PARTIAL',
      `unexpected acceptance_status for ${row.scenario_id || row.image_name}: ${row.acceptance_status}`,
    );
    if (row.scenario_class === 'C_honest_limit') {
      assert.equal(row.acceptance_status, 'PARTIAL');
    } else {
      assert.equal(row.acceptance_status, 'BLOCKED');
    }
  }
});

// Theme 5: FORBIDDEN_OWNER_FACING_PATTERNS covers synthetic seed/harness identifiers.
test('forbidden patterns reject owner-proof seed and E2E harness identifiers', () => {
  assert.throws(
    () => assertNoForbiddenOwnerFacingText('Kenny Dorham — Quiet Kenny (owner-proof seed 1)', 't'),
    /FORBIDDEN_OWNER_FACING_TEXT/,
  );
  assert.throws(
    () => assertNoForbiddenOwnerFacingText('Ran via E2E Browse harness', 't'),
    /FORBIDDEN_OWNER_FACING_TEXT/,
  );
});

// Theme 6: FORBIDDEN_OWNER_FACING_PATTERNS covers synthetic fixture/id identifiers.
test('forbidden patterns reject fixture-, rec-bn-, and nego-sold-comp- identifiers', () => {
  assert.throws(() => assertNoForbiddenOwnerFacingText('fixture-embed-v1 hash mismatch', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('rec-bn-1 matched your preferences', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('nego-sold-comp-3 supports this range', 't'));
});

// Theme 7: FORBIDDEN_OWNER_FACING_PATTERNS covers bare internal reason codes.
test('forbidden patterns reject bare internal reason codes', () => {
  assert.throws(() => assertNoForbiddenOwnerFacingText('Risk flags: NO_BIDS, SMALL_COMPARABLE_SAMPLE', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('budget_fit score is high', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('picture_disc_excluded per your preference', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('portfolio_diversification mode selected', 't'));
});

// Theme 8: FORBIDDEN_OWNER_FACING_PATTERNS covers internal telemetry key=value leakage.
test('forbidden patterns reject internal telemetry key=value strings', () => {
  assert.throws(() => assertNoForbiddenOwnerFacingText('automatic_send_allowed=true', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('message_sent=true', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('engine_invoked=phase33c_deterministic_scarcity_v2', 't'));
});

// Theme 9: FORBIDDEN_OWNER_FACING_PATTERNS covers internal scope/metadata vocabulary.
test('forbidden patterns reject authorized_catalog and public_metadata vocabulary', () => {
  assert.throws(() => assertNoForbiddenOwnerFacingText('Sourced from authorized_catalog', 't'));
  assert.throws(() => assertNoForbiddenOwnerFacingText('Only public_metadata is shown', 't'));
});

// Theme 10: the forbidden-pattern assertion never false-positives on clean customer copy.
test('forbidden patterns do not false-positive on clean customer-facing sentences', () => {
  assert.doesNotThrow(() =>
    assertNoForbiddenOwnerFacingText(
      'Fits within your stated budget and diversifies your collection across artists.',
      't',
    ),
  );
  assert.ok(FORBIDDEN_OWNER_FACING_PATTERNS.length >= 10);
});

// Theme 11: SUCCESS_DATA_FLOORS.scarcity requires at least 2 sold observations.
test('SUCCESS_DATA_FLOORS.scarcity requires min_sold_observations of 2', () => {
  assert.equal(SUCCESS_DATA_FLOORS.scarcity.min_sold_observations, 2);
});

// Theme 12: assertSuccessScenarioDataFloor rejects a zero-sold scarcity success sample.
test('assertSuccessScenarioDataFloor rejects zero-sold scarcity evidence', () => {
  assert.throws(
    () => assertSuccessScenarioDataFloor('scarcity', { sold_observations: 0, observations: 6 }),
    (err) => err.code === SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE,
  );
});

// Theme 13: assertSuccessScenarioDataFloor accepts evidence that clears the floor.
test('assertSuccessScenarioDataFloor accepts evidence at or above the floor', () => {
  assert.doesNotThrow(() =>
    assertSuccessScenarioDataFloor('scarcity', { sold_observations: 2, observations: 6 }),
  );
  assert.doesNotThrow(() =>
    assertSuccessScenarioDataFloor('valuation', { sold_comparables: 3, asking_comparables: 3 }),
  );
});

// Theme 14: translateInternalCode never leaks raw SCREAMING_SNAKE_CASE for known codes.
test('translateInternalCode humanizes every required internal code', () => {
  const codes = [
    'NO_BIDS',
    'SMALL_COMPARABLE_SAMPLE',
    'budget_fit',
    'picture_disc_excluded',
    'portfolio_diversification',
    'diversification',
    'collection_gap',
  ];
  for (const code of codes) {
    const translated = translateInternalCode(code);
    assert.ok(translated.length > 0, `no translation for ${code}`);
    assert.ok(!/^[A-Z0-9_]+$/.test(translated), `translation for ${code} leaked raw code: ${translated}`);
  }
});

// Theme 15: assertCapabilityResponseStructure requires valuation ranges to be present.
test('assertCapabilityResponseStructure requires valuation ranges', () => {
  assert.throws(
    () =>
      assertCapabilityResponseStructure('valuation', {
        summary: 'Some summary text with enough words to clear the floor easily.',
      }),
    (err) => err.code === 'RESPONSE_STRUCTURE_INCOMPLETE',
  );
  assert.doesNotThrow(() =>
    assertCapabilityResponseStructure('valuation', {
      quick_sale_range: { low: 40, high: 55 },
      fair_market_range: { low: 55, high: 70 },
      patient_sale_range: { low: 65, high: 85 },
      summary: 'Fair market range reflects recent comparable sold prices for this pressing.',
    }),
  );
});

// Theme 16: assertCapabilityResponseStructure enforces MIN_RESPONSE_WORD_TARGETS for non-abstained results.
test('assertCapabilityResponseStructure rejects a too-thin non-abstained summary', () => {
  assert.ok(MIN_RESPONSE_WORD_TARGETS.scarcity > 0);
  assert.throws(
    () =>
      assertCapabilityResponseStructure('scarcity', {
        scarcity_label: 'scarce',
        sold_count: 2,
        asking_count: 3,
        summary: 'Scarce.',
      }),
    (err) => err.code === 'RESPONSE_TOO_THIN',
  );
});

// Theme 17: assertCapabilityResponseStructure skips the word-floor check for honest abstentions.
test('assertCapabilityResponseStructure allows a short honest abstention summary', () => {
  assert.doesNotThrow(() =>
    assertCapabilityResponseStructure('scarcity', {
      scarcity_label: 'insufficient_data',
      sold_count: 0,
      asking_count: 2,
      summary: 'Not enough data.',
    }),
  );
});

// Theme 18: ai-customer-copy.ts defines CODE_COPY entries for the required internal codes.
test('ai-customer-copy.ts source defines CODE_COPY entries for required codes', () => {
  const src = readSrc(CUSTOMER_COPY_TS_PATH);
  for (const code of [
    'NO_BIDS',
    'SMALL_COMPARABLE_SAMPLE',
    'BUDGET_FIT',
    'PICTURE_DISC_EXCLUDED',
    'PORTFOLIO_DIVERSIFICATION',
    'DIVERSIFICATION',
    'COLLECTION_GAP',
    'LATE_BID_PRESSURE',
  ]) {
    assert.match(src, new RegExp(`\\b${code}\\b`), `CODE_COPY is missing ${code}`);
  }
});

// Theme 19: ai-customer-copy.ts strips synthetic/harness identifier fragments.
test('ai-customer-copy.ts strips owner-proof seed, E2E, and fixture-style identifiers', () => {
  const src = readSrc(CUSTOMER_COPY_TS_PATH);
  assert.match(src, /owner-proof seed/);
  assert.match(src, /E2E Browse/);
  assert.match(src, /nego-sold-comp-/);
  assert.match(src, /rec-bn-/);
  assert.match(src, /fixture-/);
  assert.match(src, /force_sold_floor/);
  assert.match(src, /scarcity-sold-floor-/);
});

// Theme 20: the abstention headline in the panel shell is capability-aware and
// never uses scarcity/rarity wording for valuation.
test('intelligence-panel-shell.tsx never uses scarcity/rarity wording for valuation abstention', () => {
  const src = readSrc(PANEL_SHELL_TSX_PATH);
  const fnMatch = src.match(/function abstentionHeadlineForCapability[\s\S]*?\n}/);
  assert.ok(fnMatch, 'abstentionHeadlineForCapability not found');
  const fnSrc = fnMatch[0];
  const valuationCaseMatch = fnSrc.match(/case 'valuation':[\s\S]*?return ([^\n]+)/);
  assert.ok(valuationCaseMatch, 'valuation case not found in abstentionHeadlineForCapability');
  assert.doesNotMatch(valuationCaseMatch[1], /scarcity|rarity|rare\b/i);
  assert.match(fnSrc, /case 'scarcity':/);
});

// Theme 21: the scarcity engine never emits a Limited/Rare/Scarce label when
// sold_count is zero, even when active/asking supply exists.
test('scarcity engine abstains instead of labeling Limited/Rare/Scarce on zero sold comps', () => {
  const askingOnly = [
    {
      evidence_id: 'a1',
      source_type: 'listing',
      sale_kind: 'asking',
      price: 80,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T12:00:00.000Z',
      pressing_id: 'CL1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
    {
      evidence_id: 'a2',
      source_type: 'listing',
      sale_kind: 'asking',
      price: 82,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T12:00:00.000Z',
      pressing_id: 'CL1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
  ];
  const out = analyzeScarcity({
    subject: { pressing_id: 'CL1355-US', catalog_number: 'CL 1355' },
    candidates: askingOnly,
  });
  assert.equal(out.envelope.abstention.abstained, true);
  assert.ok(out.envelope.abstention.reason_codes.includes('NO_RELIABLE_SOLD_OR_AUCTION'));
  assert.ok(!['limited', 'rare', 'scarce', 'exceptional'].includes(out.result.scarcity_label));
});

// Theme 22: the scarcity engine still produces a normal label once real sold
// comps exist (regression guard against over-correcting into always-abstain).
test('scarcity engine returns a normal label once sold comps exist', () => {
  const withSold = [
    {
      evidence_id: 'a1',
      source_type: 'listing',
      sale_kind: 'asking',
      price: 80,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T12:00:00.000Z',
      pressing_id: 'CL1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
    {
      evidence_id: 's1',
      source_type: 'sale',
      sale_kind: 'sold',
      price: 70,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T12:00:00.000Z',
      pressing_id: 'CL1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
    {
      evidence_id: 's2',
      source_type: 'sale',
      sale_kind: 'sold',
      price: 72,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T12:00:00.000Z',
      pressing_id: 'CL1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
  ];
  const out = analyzeScarcity({
    subject: { pressing_id: 'CL1355-US', catalog_number: 'CL 1355' },
    candidates: withSold,
  });
  assert.equal(out.envelope.abstention.abstained, false);
  assert.ok(['limited', 'common', 'scarce', 'rare', 'exceptional'].includes(out.result.scarcity_label));
});

test('scarcity force_sold_floor injects completed sales so success can clear the data floor', () => {
  process.env.PHASE34_UNIT_TEST_HOOKS = '1';
  try {
    const out = analyzeScarcity({
      subject: { pressing_id: 'CL1355-US', catalog_number: 'CL 1355' },
      candidates: [
        {
          evidence_id: 'a1',
          source_type: 'listing',
          sale_kind: 'asking',
          price: 80,
          currency: 'USD',
          freshness_status: 'fresh',
          observed_at: '2026-06-01T12:00:00.000Z',
          pressing_id: 'CL1355-US',
          reason_codes: ['EXACT_PRESSING_MATCH'],
          authorization_scope: 'authenticated_market',
        },
      ],
      force_sold_floor: true,
    });
    assert.equal(out.envelope.abstention.abstained, false);
    assert.ok(out.result.sold_count >= 2);
  } finally {
    delete process.env.PHASE34_UNIT_TEST_HOOKS;
  }
});

test('japanese scarcity correction never shows scarce with sold 0', () => {
  const out = analyzeScarcity({
    subject: { pressing_id: 'CL1355-US', catalog_number: 'CL 1355' },
    user_intent: 'I meant the Japanese pressing, not the US mono.',
    // Stale assembly counters that previously caused Label:Scarce · sold 0.
    recent_sale_count: 0,
    active_supply_count: 17,
    candidates: [],
  });
  assert.equal(out.envelope.abstention.abstained, false);
  assert.ok(out.result.sold_count >= 1);
  assert.equal(out.result.recent_sale_count, out.result.sold_count);
  assert.notEqual(out.result.scarcity_label, 'insufficient_data');
  const evidenceText = JSON.stringify(out.result.evidence || []);
  assert.doesNotMatch(evidenceText, /scarcity-jp-/);
  assert.match(evidenceText, /Sold Japanese pressing|sold comparable/i);
});

test('product session runner forwards owner_proof_canonical_route into adapter context', () => {
  const src = readSrc(path.join(REPO, 'scripts/lib/phase34-product-session-runner.mjs'));
  assert.match(src, /owner_proof_canonical_route/);
  assert.match(src, /scheduleRow\.owner_proof_canonical_route/);
});

test('market seed uses normalized COMPLETED_SALE events, not archive-as-sold', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'scripts/lib/phase34-owner-proof-market-seed.mjs'),
    'utf8',
  );
  assert.doesNotMatch(src, /owner_listing_archived_as_sold_floor/);
  assert.doesNotMatch(src, /force_sold_floor/);
  assert.match(src, /normalized_completed_sale_events/);
  assert.match(src, /COMPLETED_SALE/);
  assert.match(src, /source_listing_id/);
  assert.match(src, /phase34-owner-proof-completed-sales\.live\.json/);
});

test('assembler never treats archived listings as sold comps', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'webapp/lib/ai-market-evidence-assembler.ts'),
    'utf8',
  );
  assert.match(src, /Archived\/paused are delisted inventory/);
  assert.match(src, /completedSaleEvents/);
  assert.doesNotMatch(src, /st === 'archived'/);
});

// Theme 23: the seed manifest records a min_sold_observations floor for scarcity_success.
test('seed manifest records min_sold_observations for scarcity_success', () => {
  const manifest = loadJson(SEED_MANIFEST_PATH);
  assert.equal(manifest.evidence_floors.scarcity_success.min_sold_observations, 2);
});

// Theme 24: DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE and
// DISCLOSURE_DID_NOT_EXPAND are exported and usable by the journey adapters'
// evidence/limitations disclosure capture loop.
test('journey adapters export the disclosure-capture error codes', () => {
  assert.equal(
    DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
    'DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE',
  );
  assert.equal(DISCLOSURE_DID_NOT_EXPAND, 'DISCLOSURE_DID_NOT_EXPAND');
});

// Theme 25: the disclosure elements in the panel shell expose an explicit,
// pollable aria-expanded attribute tied to React state (not just the native
// boolean `open` attribute), and collapse/expand independently.
test('intelligence-panel-shell.tsx wires aria-expanded onto both disclosures', () => {
  const src = readSrc(PANEL_SHELL_TSX_PATH);
  // String form is required — React omits boolean `false` attributes.
  assert.match(src, /aria-expanded=\{evidenceOpen \? 'true' : 'false'\}/);
  assert.match(src, /aria-expanded=\{limitationsOpen \? 'true' : 'false'\}/);
  assert.match(src, /setEvidenceOpen/);
  assert.match(src, /setLimitationsOpen/);
  assert.match(src, /event\.preventDefault\(\)/);
  assert.match(src, /data-testid=\{`\$\{testId\}-evidence-content`\}/);
  assert.match(src, /data-testid=\{`\$\{testId\}-limitations-content`\}/);
});

// Theme 26: journey adapters scope disclosure capture to the panel locator and
// collapse siblings before opening the next disclosure, and throw on a
// duplicate evidence/limitations screenshot rather than silently capturing it.
test('journey adapters collapse sibling disclosures and reject duplicate expanded screenshots', () => {
  const src = readSrc(path.join(REPO, 'scripts/lib/phase34-product-journeys/adapters.mjs'));
  assert.match(src, /panelLocator\.locator\(`\[data-testid="\$\{prepared\.panelTestId\}-\$\{suffix\}"\]`\)/);
  assert.match(src, /aria-expanded/);
  assert.match(src, /DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE/);
  assert.match(src, /DISCLOSURE_DID_NOT_EXPAND/);
  assert.match(src, /screenshot_state_record/);
  assert.match(src, /pre_dom_hash/);
  assert.match(src, /post_dom_hash/);
  assert.match(src, /pre_aria_expanded/);
  assert.match(src, /post_aria_expanded/);
  assert.match(src, /measurement_status/);
});

// Click-triggered capabilities (valuation listing-edit) must not start the
// waitForResponse clock during goto/prepare — that burned the 120s budget and
// crashed Node via unhandled rejection before Analyze could fire.
test('journey adapters soft-catch waitForResponse and defer click-trigger waiters', () => {
  const src = readSrc(path.join(REPO, 'scripts/lib/phase34-product-journeys/adapters.mjs'));
  assert.match(src, /attachResponseWaiter/);
  assert.match(src, /responseWaitError/);
  assert.match(src, /triggerMode === 'auto' \? attachResponseWaiter\(\) : null/);
  assert.match(src, /if \(!responsePromise\) \{\s*responsePromise = attachResponseWaiter\(\);\s*\}/s);
  assert.match(src, /\.catch\(\(err\) => \{\s*responseWaitError = err;\s*return null;\s*\}\)/s);
});

test('valuation engine applies condition correction and weak-sold honest-limit intents', async () => {
  const { runCapability } = await import('../scripts/lib/phase33c-intelligence.mjs');
  const candidates = [39, 41, 43].map((price, i) => ({
    evidence_id: `e${i}`,
    source_type: 'sale',
    sale_kind: 'sold',
    price,
    currency: 'USD',
    freshness_status: 'fresh',
    observed_at: '2026-05-15T12:00:00.000Z',
    pressing_id: 'P1',
    reason_codes: ['EXACT_PRESSING_MATCH', 'AUTHORIZED_MARKET'],
    authorization_scope: 'authenticated_market',
  }));
  const base = {
    subject: {
      release_id: 'R1',
      pressing_id: 'P1',
      condition: 'VG+',
      artist: 'Kenny Dorham',
      title: 'Quiet Kenny',
      catalog_number: 'BLP 1569',
    },
    currency: 'USD',
    candidates,
    authorized_scopes: ['authenticated_market'],
    min_sold_comps: 2,
  };
  const success = runCapability('valuation', {
    ...base,
    user_intent: 'What is a quick-sale price versus a patient-sale price for this VG+ copy?',
  });
  const corr = runCapability('valuation', {
    ...base,
    user_intent: 'Sleeve has a seam split; media is closer to VG.',
  });
  const weak = runCapability('valuation', {
    ...base,
    user_intent: 'Value this with almost no sold comps.',
  });
  assert.equal(success.envelope.abstention.abstained, false);
  assert.equal(corr.envelope.abstention.abstained, false);
  assert.ok(corr.result.correction_change);
  assert.notEqual(success.result.fair_value, corr.result.fair_value);
  assert.equal(weak.envelope.abstention.abstained, true);
  assert.equal(weak.result.sold_comparable_count, 0);
});

test('market seed syncs completed-sales file into cluster /tmp paths', () => {
  const src = readSrc(path.join(REPO, 'scripts/lib/phase34-owner-proof-market-seed.mjs'));
  assert.match(src, /syncOwnerProofCompletedSalesSeedIntoCluster/);
  assert.match(src, /\/tmp\/phase34-owner-proof-completed-sales\.live\.json/);
  assert.match(src, /kubectl/);
  const api = readSrc(path.join(REPO, 'webapp/app/api/marketplace/completed-sales/route.ts'));
  assert.match(api, /\/tmp\/phase34-owner-proof-completed-sales\.live\.json/);
});

// Theme 27: the auction panel translates risk_flags through customerCopyForCode
// instead of rendering raw internal codes.
test('auction-intelligence-panel.tsx renders risk_flags via customerCopyForCode', () => {
  const src = readSrc(AUCTION_PANEL_TSX_PATH);
  assert.match(src, /customerCopyForCode/);
  assert.match(src, /customerCopyForCode\(flag\)/);
});

// Theme 28: the recommendations panel translates/sanitizes reason codes rather
// than rendering raw snake_case/SCREAMING_SNAKE_CASE codes.
test('recommendations-intelligence-panel.tsx sanitizes reason display', () => {
  const src = readSrc(RECS_PANEL_TSX_PATH);
  assert.match(src, /sanitizeCustomerFacingText/);
});
