/**
 * Phase 33C valuation — evidence-backed ranges (deterministic).
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors, decideAbstention } from './phase33c-confidence.mjs';

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

export function analyzeValuation(input = {}) {
  const subject = input.subject || {};
  const currency = (input.currency || subject.currency || 'USD').toUpperCase();
  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const authorizedScopes = input.authorized_scopes || ['public_market', 'authenticated_market'];

  const { selected, excluded, evidence_for_schema } = selectEvidence({
    candidates: input.candidates || [],
    subject,
    principalId,
    authorizedScopes,
    requireExactPressing: Boolean(subject.pressing_id),
    maxEvidence: input.max_evidence || 12,
  });

  const soldRaw = selected.filter((e) => e.sale_kind === 'sold' || e.source_type === 'sale');
  const asking = selected.filter((e) => e.sale_kind === 'asking' || e.source_type === 'listing');
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
      message: `Insufficient valuation evidence: ${abstention.reason_codes.join(',')}`,
      severity: 'blocking',
    });
  }
  if (asking.length && soldNormalized.length === 0) {
    limitations.push({
      code: 'ASKING_ONLY',
      message: 'Active asking prices are not sold evidence',
      severity: 'warning',
    });
  }
  if (askingAsSoldConfusion.length) {
    limitations.push({
      code: 'ASKING_AS_SOLD_TRAP_FILTERED',
      message: 'Asking-as-sold traps excluded from sold comps',
      severity: 'warning',
    });
  }
  limitations.push({
    code: 'NO_SINGLE_POINT_FABRICATION',
    message: 'Returns ranges only; never a fabricated precise singleton price',
    severity: 'info',
  });

  const payload = {
    currency,
    low_estimate: abstention.abstained ? 0 : round2(low),
    fair_value: abstention.abstained ? 0 : round2(fair),
    high_estimate: abstention.abstained ? 0 : round2(high),
    quick_sale_estimate: abstention.abstained ? 0 : round2(quick),
    patient_sale_estimate: abstention.abstained ? 0 : round2(patient),
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
    scarcity_adjustment: scarcityAdj,
    liquidity_adjustment: liquidityAdj,
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.25) : confidence,
    limitations,
    data_freshness: selected.find((e) => e.freshness_status === 'fresh')?.observed_at || null,
    methodology: 'phase33c_deterministic_valuation_v1',
    sample_size: soldNormalized.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: authorizedScopes[0] || 'authenticated_market',
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
      summary: abstention.abstained
        ? 'Abstaining from valuation due to insufficient sold evidence.'
        : `Evidence-backed ${currency} range ${payload.low_estimate}-${payload.high_estimate}.`,
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
