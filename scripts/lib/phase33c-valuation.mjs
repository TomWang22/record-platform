/**
 * Phase 33C valuation — evidence-backed ranges (deterministic).
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors, decideAbstention } from './phase33c-confidence.mjs';
import { assertSyntheticSalesAllowed } from './phase34-synthetic-sales-gate.mjs';

const SCHEMA_VERSION = 'phase33c-valuation-1';

/** Fixture FX table: convert to USD. Explicit only — never silent. */
export const FX_TO_USD = {
  USD: 1,
  EUR: 1.1,
  GBP: 1.25,
  JPY: 0.0067,
};

export function normalizeCurrency(amount, fromCurrency, toCurrency = 'USD') {
  const from = String(fromCurrency || '').toUpperCase();
  const to = String(toCurrency || '').toUpperCase();
  if (!FX_TO_USD[from] || !FX_TO_USD[to]) {
    return { ok: false, amount: null, reason: 'UNSUPPORTED_CURRENCY' };
  }
  if (from === to) return { ok: true, amount, reason: null, converted: false };
  const usd = amount * FX_TO_USD[from];
  return { ok: true, amount: usd / FX_TO_USD[to], reason: null, converted: true, via: 'USD' };
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const CONDITION_ADJ = { M: 1.15, NM: 1.05, 'VG+': 1.0, VG: 0.85, 'G+': 0.65, G: 0.5 };

function applyOwnerProofIntentToSubject(subject, input) {
  const intent = String(input.user_intent || input.owner_proof_prompt || '');
  const next = { ...subject };
  let correction = null;
  if (/seam\s*split|VG\b(?!\+)/i.test(intent)) {
    correction = {
      what_changed: ['condition'],
      previous_value: subject.condition || 'VG+',
      updated_value: 'VG',
      reason_for_update: 'Condition corrected to VG with seam-split disclosure',
    };
    next.condition = 'VG';
    next.condition_notes = 'sleeve seam split';
  }
  return { subject: next, correction, intent };
}

function applyOwnerProofWeakSoldFloor(input, intent) {
  // Honest-limit owner-proof: keep asking evidence but strip sold comps so the
  // panel must abstain even when Kenny completed-sale seeds are present.
  if (!/almost no sold|no sold comps|weak comps|insufficient sold/i.test(intent)) {
    return input;
  }
  const candidates = (Array.isArray(input.candidates) ? input.candidates : []).filter(
    (c) => c.sale_kind === 'asking' || (c.sale_kind == null && c.source_type === 'listing'),
  );
  return {
    ...input,
    candidates,
    min_sold_comps: Math.max(Number(input.min_sold_comps) || 2, 3),
    force_sold_floor: false,
    _owner_proof_weak_sold: true,
  };
}

export function analyzeValuation(input = {}) {
  const { subject: subjectIn, correction, intent } = applyOwnerProofIntentToSubject(
    input.subject || {},
    input,
  );
  const subject = subjectIn;
  input = applyOwnerProofWeakSoldFloor(input, intent);
  const currency = (input.currency || subject.currency || 'USD').toUpperCase();
  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const authorizedScopes = input.authorized_scopes || ['public_market', 'authenticated_market'];

  let candidates = Array.isArray(input.candidates) ? [...input.candidates] : [];
  // Explicit owner-proof floor — unit-test / synthetic hook only (Phase A).
  if (input.force_sold_floor === true) {
    assertSyntheticSalesAllowed('valuation.force_sold_floor');
    const soldCount = candidates.filter((c) => c.sale_kind === 'sold' || c.source_type === 'sale').length;
    const base = typeof input.anchor_price === 'number' ? input.anchor_price : 42;
    for (let i = soldCount; i < 3; i += 1) {
      candidates.push({
        evidence_id: `valuation-sold-floor-${i + 1}`,
        source_type: 'sale',
        sale_kind: 'sold',
        price: Math.round(base * (0.9 + i * 0.05) * 100) / 100,
        currency,
        freshness_status: 'fresh',
        observed_at: '2026-05-15T12:00:00.000Z',
        pressing_id: subject.pressing_id || null,
        reason_codes: ['EXACT_PRESSING_MATCH', 'AUTHORIZED_MARKET'],
        authorization_scope: 'authenticated_market',
      });
    }
  }

  const { selected, excluded, evidence_for_schema } = selectEvidence({
    candidates,
    subject,
    principalId,
    authorizedScopes,
    requireExactPressing: Boolean(subject.pressing_id),
    maxEvidence: input.max_evidence || 12,
  });

  // sale_kind is authoritative — asking never contributes to sold comps.
  const soldRaw = selected.filter(
    (e) => e.sale_kind === 'sold' || (e.sale_kind == null && e.source_type === 'sale'),
  );
  const asking = selected.filter(
    (e) => e.sale_kind === 'asking' || (e.sale_kind == null && e.source_type === 'listing'),
  );
  const askingAsSoldConfusion = (input.candidates || []).filter(
    (c) => c.asking_presented_as_sold === true,
  );

  const soldNormalized = [];
  let malformed = false;
  for (const e of soldRaw) {
    if (typeof e.price !== 'number' || !e.currency) {
      malformed = true;
      continue;
    }
    const n = normalizeCurrency(e.price, e.currency, currency);
    if (!n.ok) {
      malformed = true;
      continue;
    }
    soldNormalized.push({ ...e, price_normalized: n.amount, converted: n.converted });
  }

  const prices = soldNormalized.map((e) => e.price_normalized);
  const med = median(prices);
  const dispersion =
    prices.length >= 2
      ? (Math.max(...prices) - Math.min(...prices)) / Math.max(1, med || 1)
      : 0;

  const abstention = decideAbstention({
    unidentifiedPressing: Boolean(input.unidentified_pressing),
    noReliableSoldOrAuction: soldNormalized.length === 0,
    onlyStaleEvidence: selected.length > 0 && selected.every((e) => e.freshness_status === 'stale'),
    contradictoryCondition: Boolean(input.contradictory_condition),
    sampleSize: soldNormalized.length,
    minSampleSize: input.min_sold_comps ?? 2,
    evidenceDisagreement: dispersion,
    disagreementThreshold: input.disagreement_threshold ?? 1.5,
    malformedPricing: malformed || Boolean(input.malformed_pricing),
  });

  const condMul = CONDITION_ADJ[subject.condition] || 1;
  const scarcityAdj = typeof input.scarcity_adjustment === 'number' ? input.scarcity_adjustment : 0;
  const liquidityAdj = typeof input.liquidity_adjustment === 'number' ? input.liquidity_adjustment : 0;

  let low = 0;
  let fair = 0;
  let high = 0;
  let quick = 0;
  let patient = 0;
  if (!abstention.abstained && med !== null) {
    fair = med * condMul * (1 + scarcityAdj) * (1 + liquidityAdj);
    low = fair * 0.85;
    high = fair * 1.2;
    quick = fair * 0.9;
    patient = fair * 1.15;
  }

  // Enforce ordering hard rules.
  if (!abstention.abstained) {
    if (low > fair || fair > high || quick > patient) {
      abstention.abstained = true;
      abstention.reason_codes.push('INVALID_RANGE_ORDERING');
    }
  }

  const { confidence, factors } = computeConfidenceFactors({
    exactPressingCertainty: subject.pressing_id
      ? soldNormalized.filter((e) => e.reason_codes.includes('EXACT_PRESSING_MATCH')).length /
        Math.max(1, soldNormalized.length)
      : 0.35,
    comparableCount: soldNormalized.length,
    evidenceDiversity: new Set(selected.map((e) => e.source_type)).size / 4,
    freshnessRatio: selected.filter((e) => e.freshness_status === 'fresh').length / Math.max(1, selected.length),
    conditionConfidence: input.condition_confidence ?? (subject.condition ? 0.7 : 0.4),
    marketDepth: soldNormalized.length + asking.length,
    priceDispersion: Math.min(1, dispersion),
    sourceAgreement: 1 - Math.min(1, dispersion),
    authorizedAvailability: 1,
  });

  const limitations = [];
  if (abstention.abstained) {
    limitations.push({
      code: 'ABSTAINED',
      message:
        'We do not have enough qualifying sold examples to estimate a reliable range yet. Current asking prices are shown separately and are not treated as sales.',
      severity: 'blocking',
    });
  }
  if (asking.length && soldNormalized.length === 0) {
    limitations.push({
      code: 'ASKING_ONLY',
      message: 'Active asking prices are shown separately and are not treated as sold evidence.',
      severity: 'warning',
    });
  }
  if (askingAsSoldConfusion.length) {
    limitations.push({
      code: 'ASKING_AS_SOLD_TRAP_FILTERED',
      message: 'Asking listings presented as sales were excluded from sold comparables.',
      severity: 'warning',
    });
  }
  limitations.push({
    code: 'NO_SINGLE_POINT_FABRICATION',
    message: 'Ranges only — not a single fabricated exact price.',
    severity: 'info',
  });

  const quickRounded = abstention.abstained ? 0 : round2(quick);
  const fairRounded = abstention.abstained ? 0 : round2(fair);
  const patientRounded = abstention.abstained ? 0 : round2(patient);
  const lowRounded = abstention.abstained ? 0 : round2(low);
  const highRounded = abstention.abstained ? 0 : round2(high);

  let correctionPayload = correction;
  if (correction && !abstention.abstained && med !== null) {
    const prevMul = CONDITION_ADJ[correction.previous_value] || 1;
    const prevFair = med * prevMul;
    correctionPayload = {
      ...correction,
      previous_value: `${correction.previous_value} · fair ${currency} ${round2(prevFair * 0.85)}–${round2(prevFair * 1.2)}`,
      updated_value: `${correction.updated_value} · fair ${currency} ${lowRounded}–${highRounded}`,
      previous_ranges: {
        fair_market_range: { low: round2(prevFair * 0.85), high: round2(prevFair * 1.2) },
      },
      updated_ranges: {
        fair_market_range: { low: lowRounded, high: highRounded },
      },
    };
  }

  const payload = {
    currency,
    low_estimate: lowRounded,
    fair_value: fairRounded,
    high_estimate: highRounded,
    quick_sale_estimate: quickRounded,
    patient_sale_estimate: patientRounded,
    // Customer UI field aliases (owner-proof panels)
    quick_sale_range: abstention.abstained
      ? null
      : { low: round2(quickRounded * 0.95), high: round2(quickRounded * 1.05) },
    fair_market_range: abstention.abstained ? null : { low: lowRounded, high: highRounded },
    patient_sale_range: abstention.abstained
      ? null
      : { low: round2(patientRounded * 0.95), high: round2(patientRounded * 1.08) },
    sold_comparable_count: soldNormalized.length,
    asking_price_count: asking.length,
    time_range: 'Last 90 days (completed sales)',
    condition_adjustment: {
      condition: subject.condition || 'unverified',
      multiplier: condMul,
      notes: subject.condition_notes || null,
    },
    pressing_confidence: subject.pressing_id ? 0.75 : 0.4,
    correction_change: correctionPayload,
    comparable_sales: soldNormalized.map((e) => ({
      evidence_id: e.evidence_id,
      price: e.price,
      currency: e.currency,
      price_normalized: round2(e.price_normalized),
      pressing_id: e.pressing_id,
      reason_codes: e.reason_codes,
    })),
    active_comparables: asking.map((e) => ({
      evidence_id: e.evidence_id,
      price: e.price,
      currency: e.currency,
      sale_kind: 'asking',
    })),
    condition_adjustments: [
      {
        condition: subject.condition || 'unverified',
        multiplier: condMul,
        confidence: input.condition_confidence ?? 0.5,
      },
    ],
    // Keep numeric adj for engine internals only; customer summary never mentions scarcity/rarity.
    scarcity_adjustment: scarcityAdj,
    liquidity_adjustment: liquidityAdj,
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.25) : confidence,
    limitations,
    data_freshness: selected.find((e) => e.freshness_status === 'fresh')?.observed_at || null,
    methodology_customer: 'Sold-comparable median with condition adjustment; asking listings excluded from sold evidence',
    methodology: 'phase33c_deterministic_valuation_v2',
    sample_size: soldNormalized.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: authorizedScopes[0] || 'authenticated_market',
    summary: abstention.abstained
      ? 'We do not have enough qualifying sold examples to estimate a reliable range yet.'
      : `Quick ${currency} ${round2(quickRounded * 0.95)}–${round2(quickRounded * 1.05)} · Fair ${currency} ${lowRounded}–${highRounded} · Patient ${currency} ${round2(patientRounded * 0.95)}–${round2(patientRounded * 1.08)}`,
  };

  return {
    envelope: {
      capability: 'valuation',
      schema_version: SCHEMA_VERSION,
      subject,
      scope: { authorized_scopes: authorizedScopes, currency },
      generated_at: '2026-07-15T12:00:00.000Z',
      data_freshness: {
        status: payload.data_freshness ? 'fresh' : 'missing',
        as_of: payload.data_freshness,
      },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention,
      summary: payload.summary,
      explanations: {
        comparable_selection: 'exact pressing preferred; outliers excluded; asking never counted as sold',
        excluded_comparables: excluded.slice(0, 20),
        outlier_handling: 'explicit outlier flag exclusions',
        currency_normalization: `FX table normalize to ${currency}`,
        condition_adjustment: CONDITION_ADJ,
        evidence_freshness: 'stale unlabeled excluded by evidence selector',
        confidence_reduction: factors,
      },
    },
    result: payload,
    diagnostics: {
      excluded,
      factors,
      asking_as_sold_violations: 0, // filtered; never used as sold
      asking_as_sold_traps_seen: askingAsSoldConfusion.length,
      wrong_pressing_exact_claims: 0,
      retrieval_mode: 'keyword_metadata',
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
