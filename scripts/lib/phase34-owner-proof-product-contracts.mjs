/**
 * Phase 34 owner-proof product contracts.
 *
 * Shared, testable rules that keep AI intelligence responses customer-safe and
 * honest about data floors. These contracts are consumed by:
 *   - scripts/ai-platform/verify-phase34-owner-proof-product-remediation.mjs
 *   - tests/phase34-owner-proof-product-remediation.test.mjs
 *   - engine/UI code that wants to assert before rendering to a customer.
 *
 * Nothing here mutates or reads live evidence roots. Pure functions only.
 */

export const SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE = 'SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET';

/**
 * Regex patterns that must never appear in text rendered to a customer.
 * Case-insensitive; each pattern targets a distinct internal/synthetic leakage class.
 */
export const FORBIDDEN_OWNER_FACING_PATTERNS = [
  /owner-proof seed/i,
  /\bE2E\b/i,
  /\bfixture-[a-z0-9-]*/i,
  /\brec-bn-\d+/i,
  /\bnego-sold-comp-[a-z0-9-]*/i,
  /\bNO_BIDS\b/i,
  /\bSMALL_COMPARABLE_SAMPLE\b/i,
  /\bbudget_fit\b/i,
  /\bpicture_disc_excluded\b/i,
  /\bportfolio_diversification\b/i,
  /\bautomatic_send_allowed\s*=/i,
  /\bmessage_sent\s*=/i,
  /\bengine_invoked\s*=/i,
  /\bauthorized_catalog\b/i,
  /\bpublic_metadata\b/i,
];

/**
 * Throws when `text` contains any forbidden owner-facing leakage pattern.
 * `context` is included in the thrown error for debuggability (e.g. panel/testId).
 */
export function assertNoForbiddenOwnerFacingText(text, context = 'unknown') {
  const value = String(text ?? '');
  const hit = FORBIDDEN_OWNER_FACING_PATTERNS.find((re) => re.test(value));
  if (hit) {
    const err = new Error(
      `FORBIDDEN_OWNER_FACING_TEXT:${context}:${hit.toString()}:${value.slice(0, 160)}`,
    );
    err.code = 'FORBIDDEN_OWNER_FACING_TEXT';
    err.pattern = hit.toString();
    err.context = context;
    throw err;
  }
  return { ok: true };
}

/**
 * Minimum live evidence a success (A_success) scenario must clear before its
 * result is eligible for owner visual review. Mirrors the remediation brief.
 */
export const SUCCESS_DATA_FLOORS = {
  scarcity: {
    min_sold_observations: 2,
    min_observations: 5,
  },
  valuation: {
    min_sold_comparables: 3,
    min_asking_comparables: 3,
  },
  auction_intelligence: {
    min_watched_lots: 5,
  },
  semantic_search: {
    min_results: 5,
  },
  recommendations: {
    min_candidates: 8,
    min_rendered_cards: 5,
  },
  market_analytics: {
    min_population: 20,
  },
  embeddings: {
    min_observations: 1,
  },
  negotiation_assistance: {
    min_observations: 0,
  },
};

/**
 * Throws SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET when `evidenceStats` does not clear
 * the SUCCESS_DATA_FLOORS entry for `capability`. `evidenceStats` is a loose bag
 * of counters — only the keys relevant to the capability's floor are checked.
 */
export function assertSuccessScenarioDataFloor(capability, evidenceStats = {}) {
  const floors = SUCCESS_DATA_FLOORS[capability];
  if (!floors) {
    const err = new Error(`${SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE}:unknown_capability:${capability}`);
    err.code = SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE;
    throw err;
  }
  const fail = (detail) => {
    const err = new Error(`${SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE}:${capability}:${detail}`);
    err.code = SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET_CODE;
    err.capability = capability;
    err.detail = detail;
    throw err;
  };

  for (const [floorKey, minValue] of Object.entries(floors)) {
    const statKey = floorKey.replace(/^min_/, '');
    const observed = Number(evidenceStats[statKey] ?? evidenceStats[floorKey] ?? 0);
    if (!Number.isFinite(observed) || observed < minValue) {
      fail(`${statKey}:observed=${observed}:required=${minValue}`);
    }
  }
  return { ok: true, capability, floors };
}

/**
 * Internal/technical codes translated into short customer-facing phrases.
 * Keys are matched case-insensitively; both SCREAMING_SNAKE and snake_case forms
 * used across the codebase are supported.
 */
const INTERNAL_CODE_TRANSLATIONS = {
  NO_BIDS: 'No bids yet — treat the current asking price as a starting point, not a market price.',
  SMALL_COMPARABLE_SAMPLE: 'Only a small number of comparable lots were available for this comparison.',
  BUDGET_FIT: 'Fits within your stated budget.',
  PICTURE_DISC_EXCLUDED: 'Picture discs were excluded per your preference.',
  PORTFOLIO_DIVERSIFICATION: 'Chosen to diversify your collection across artists and labels.',
  DIVERSIFICATION: 'Chosen to diversify your collection across artists and labels.',
  COLLECTION_GAP: 'Fills a gap in your existing collection.',
  LATE_BID_PRESSURE: 'Bidding activity is concentrated near the auction close.',
};

/**
 * Translate an internal code (any case) into a short customer-facing phrase.
 * Falls back to a humanized (underscore-to-space, lowercased) version of the
 * code rather than ever surfacing raw SCREAMING_SNAKE_CASE or snake_case.
 */
export function translateInternalCode(code) {
  if (!code) return ''
  const key = String(code).trim().toUpperCase();
  if (INTERNAL_CODE_TRANSLATIONS[key]) return INTERNAL_CODE_TRANSLATIONS[key];
  return String(code).trim().replace(/[_-]+/g, ' ').toLowerCase();
}

/**
 * Minimum word counts for the primary customer-facing summary/explanation text
 * per capability. Used to catch responses that are technically present but too
 * thin to be useful (e.g. a single terse sentence for a market analytics report).
 */
export const MIN_RESPONSE_WORD_TARGETS = {
  scarcity: 10,
  valuation: 8,
  auction_intelligence: 5,
  embeddings: 6,
  semantic_search: 6,
  negotiation_assistance: 12,
  recommendations: 0,
  market_analytics: 8,
};

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

const REQUIRED_RESULT_FIELDS = {
  scarcity: ['scarcity_label', 'sold_count', 'asking_count', 'summary'],
  valuation: ['quick_sale_range', 'fair_market_range', 'patient_sale_range', 'summary'],
  auction_intelligence: ['temperature_label', 'summary'],
  embeddings: ['summary'],
  semantic_search: ['summary'],
  negotiation_assistance: ['strategy', 'draft_reply', 'summary'],
  // The recommendations engine result has no top-level `summary`; the
  // explainable customer-facing text lives per-card in `reason_customer`.
  recommendations: ['recommendations'],
  market_analytics: ['summary'],
};

/**
 * Heuristic structural check for a capability's `result` payload: required
 * fields must be present, and the customer-facing summary must clear the
 * minimum word target for that capability (skipped when the result reflects
 * an honest abstention, since short abstentions are expected and desirable).
 */
export function assertCapabilityResponseStructure(capability, result = {}) {
  const requiredFields = REQUIRED_RESULT_FIELDS[capability];
  if (!requiredFields) {
    const err = new Error(`RESPONSE_STRUCTURE_UNKNOWN_CAPABILITY:${capability}`);
    err.code = 'RESPONSE_STRUCTURE_UNKNOWN_CAPABILITY';
    throw err;
  }
  const missing = requiredFields.filter((f) => result[f] === undefined || result[f] === null);
  if (missing.length) {
    const err = new Error(`RESPONSE_STRUCTURE_INCOMPLETE:${capability}:${missing.join(',')}`);
    err.code = 'RESPONSE_STRUCTURE_INCOMPLETE';
    err.capability = capability;
    err.missing_fields = missing;
    throw err;
  }

  const abstained = Boolean(result.abstention_reason) || result.scarcity_label === 'insufficient_data';
  if (!abstained) {
    const target = MIN_RESPONSE_WORD_TARGETS[capability] ?? 0;
    const words = wordCount(result.summary);
    if (words < target) {
      const err = new Error(
        `RESPONSE_TOO_THIN:${capability}:words=${words}:required=${target}`,
      );
      err.code = 'RESPONSE_TOO_THIN';
      err.capability = capability;
      err.word_count = words;
      err.required_word_count = target;
      throw err;
    }
  }

  return { ok: true, capability };
}
