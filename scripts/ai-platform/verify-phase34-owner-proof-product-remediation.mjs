#!/usr/bin/env node
/**
 * Verify the Phase 34 owner-proof PRODUCT remediation artifacts:
 *  - the visual defects ledger exists and carries every required defect code
 *  - the product contracts module loads and behaves as specified
 *  - forbidden owner-facing patterns actually reject known-bad sample strings
 *  - the scarcity success-scenario data floor rejects a zero-sold sample
 *
 * Does NOT touch /tmp/phase34-owner-proof-live-recapture-v3 or the frozen
 * owner-review-artifacts/phase34/owner-proof-live-v3 export.
 */
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
} from '../lib/phase34-owner-proof-product-contracts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const DEFECTS_PATH = path.join(__dirname, 'phase34-owner-proof-v3-visual-defects.json');
const SCENARIOS_PATH = path.join(__dirname, 'phase34-owner-proof-scenarios.json');

const REQUIRED_DEFECT_CODES = [
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

const FORBIDDEN_FORBIDDEN_ROOTS = [
  '/tmp/phase34-owner-proof-live-recapture-v4',
];

function fail(issues, code, detail) {
  issues.push(`${code}:${detail}`);
}

function main() {
  const issues = [];

  // 1. Defects ledger exists with required schema + defect code coverage.
  if (!fs.existsSync(DEFECTS_PATH)) {
    fail(issues, 'DEFECTS_LEDGER_MISSING', DEFECTS_PATH);
  } else {
    const doc = JSON.parse(fs.readFileSync(DEFECTS_PATH, 'utf8'));
    if (doc.schema_version !== 'phase34-owner-proof-v3-visual-defects-v1') {
      fail(issues, 'DEFECTS_LEDGER_SCHEMA_MISMATCH', String(doc.schema_version));
    }
    if (!Array.isArray(doc.rows) || doc.rows.length < 44) {
      fail(issues, 'DEFECTS_LEDGER_ROW_COUNT', String(doc.rows?.length));
    }
    const imageRows = (doc.rows || []).filter((r) => r.image_name);
    if (imageRows.length !== 20) {
      fail(issues, 'DEFECTS_LEDGER_IMAGE_ROW_COUNT', String(imageRows.length));
    }
    const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf8')).scenarios;
    const scenarioIdsInLedger = new Set((doc.rows || []).map((r) => r.scenario_id));
    for (const s of scenarios) {
      if (!scenarioIdsInLedger.has(s.scenario_id)) {
        fail(issues, 'DEFECTS_LEDGER_MISSING_SCENARIO', s.scenario_id);
      }
    }
    const observedCodes = new Set((doc.rows || []).flatMap((r) => r.required_repairs || []));
    for (const code of REQUIRED_DEFECT_CODES) {
      if (!observedCodes.has(code)) {
        fail(issues, 'DEFECTS_LEDGER_MISSING_DEFECT_CODE', code);
      }
    }
    for (const row of doc.rows || []) {
      if (row.acceptance_status !== 'BLOCKED' && row.acceptance_status !== 'PARTIAL') {
        fail(issues, 'DEFECTS_LEDGER_BAD_ACCEPTANCE_STATUS', `${row.scenario_id}:${row.acceptance_status}`);
      }
    }
  }

  // 2. Product contracts module behaves as specified.
  if (!Array.isArray(FORBIDDEN_OWNER_FACING_PATTERNS) || FORBIDDEN_OWNER_FACING_PATTERNS.length < 10) {
    fail(issues, 'CONTRACTS_FORBIDDEN_PATTERNS_TOO_FEW', String(FORBIDDEN_OWNER_FACING_PATTERNS?.length));
  }

  const badSamples = [
    'Kenny Dorham — Quiet Kenny (owner-proof seed 1)',
    'Ran via E2E Browse harness',
    'fixture-embed-v1 hash mismatch',
    'rec-bn-1 matched your preferences',
    'nego-sold-comp-3 supports this range',
    'Risk flags: NO_BIDS, SMALL_COMPARABLE_SAMPLE',
    'budget_fit score is high',
    'picture_disc_excluded per your preference',
    'portfolio_diversification mode selected',
    'automatic_send_allowed=true',
    'message_sent=true',
    'engine_invoked=phase33c_deterministic_scarcity_v2',
    'Sourced from authorized_catalog',
    'Only public_metadata is shown',
  ];
  for (const sample of badSamples) {
    try {
      assertNoForbiddenOwnerFacingText(sample, 'verifier-sample');
      fail(issues, 'CONTRACTS_FORBIDDEN_PATTERN_DID_NOT_REJECT', sample);
    } catch (err) {
      if (err.code !== 'FORBIDDEN_OWNER_FACING_TEXT') {
        fail(issues, 'CONTRACTS_FORBIDDEN_PATTERN_WRONG_ERROR', String(err.message || err));
      }
    }
  }
  try {
    assertNoForbiddenOwnerFacingText('This is a normal customer-safe sentence.', 'verifier-sample');
  } catch {
    fail(issues, 'CONTRACTS_FORBIDDEN_PATTERN_FALSE_POSITIVE', 'clean sentence rejected');
  }

  // 3. Success floors reject a zero-sold scarcity sample.
  try {
    assertSuccessScenarioDataFloor('scarcity', { sold_observations: 0, observations: 5 });
    fail(issues, 'SUCCESS_FLOOR_DID_NOT_REJECT_ZERO_SOLD', 'scarcity');
  } catch (err) {
    if (err.code !== 'SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET') {
      fail(issues, 'SUCCESS_FLOOR_WRONG_ERROR', String(err.message || err));
    }
  }
  try {
    assertSuccessScenarioDataFloor('scarcity', { sold_observations: 2, observations: 5 });
  } catch (err) {
    fail(issues, 'SUCCESS_FLOOR_FALSE_POSITIVE', String(err.message || err));
  }
  for (const capability of Object.keys(SUCCESS_DATA_FLOORS)) {
    if (!SUCCESS_DATA_FLOORS[capability] || typeof SUCCESS_DATA_FLOORS[capability] !== 'object') {
      fail(issues, 'SUCCESS_FLOOR_MALFORMED', capability);
    }
  }

  // 4. translateInternalCode / assertCapabilityResponseStructure sanity.
  const requiredTranslations = [
    'NO_BIDS',
    'SMALL_COMPARABLE_SAMPLE',
    'budget_fit',
    'picture_disc_excluded',
    'portfolio_diversification',
    'diversification',
    'collection_gap',
  ];
  for (const code of requiredTranslations) {
    const translated = translateInternalCode(code);
    if (!translated || /^[A-Z0-9_]+$/.test(translated)) {
      fail(issues, 'TRANSLATE_INTERNAL_CODE_LEAKS_RAW_CODE', code);
    }
  }
  try {
    assertCapabilityResponseStructure('scarcity', {
      scarcity_label: 'scarce',
      sold_count: 2,
      asking_count: 3,
      summary: 'Exact pressing looks scarce: 2 sold, 3 asking, release-level tracked separately.',
    });
  } catch (err) {
    fail(issues, 'RESPONSE_STRUCTURE_FALSE_POSITIVE', String(err.message || err));
  }
  try {
    assertCapabilityResponseStructure('scarcity', { scarcity_label: 'scarce' });
    fail(issues, 'RESPONSE_STRUCTURE_DID_NOT_REJECT_MISSING_FIELDS', 'scarcity');
  } catch (err) {
    if (err.code !== 'RESPONSE_STRUCTURE_INCOMPLETE') {
      fail(issues, 'RESPONSE_STRUCTURE_WRONG_ERROR', String(err.message || err));
    }
  }
  if (!MIN_RESPONSE_WORD_TARGETS || typeof MIN_RESPONSE_WORD_TARGETS.scarcity !== 'number') {
    fail(issues, 'MIN_RESPONSE_WORD_TARGETS_MISSING', 'scarcity');
  }

  // 5. Forbidden roots / freeze integrity — never mutate or create these.
  for (const forbidden of FORBIDDEN_FORBIDDEN_ROOTS) {
    if (fs.existsSync(forbidden)) {
      fail(issues, 'RECAPTURE_V4_MUST_NOT_EXIST', forbidden);
    }
  }
  const frozenV3 = path.join(REPO, 'owner-review-artifacts/phase34/owner-proof-live-v3');
  if (fs.existsSync(frozenV3) && !fs.existsSync(path.join(frozenV3, 'FROZEN_BLOCKED_EVIDENCE'))) {
    fail(issues, 'FROZEN_V3_MARKER_MISSING', frozenV3);
  }

  const report = {
    status: issues.length ? 'FAIL' : 'PASS',
    defects_ledger: path.relative(REPO, DEFECTS_PATH),
    required_defect_code_count: REQUIRED_DEFECT_CODES.length,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(issues.length ? 2 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
