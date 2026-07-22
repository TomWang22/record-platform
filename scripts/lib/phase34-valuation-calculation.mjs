/**
 * Immutable valuation calculation records for claim-ledger linkage.
 * MODEL_WEIGHT_TRAINING remains NO.
 */
import crypto from 'node:crypto';
import { median as medianFn } from './phase34-deterministic-analytics.mjs';

export const VALUATION_CALC_VERSION = 'phase34-valuation-calc-v1';

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Build an immutable valuation calculation from an evidence snapshot + structured result.
 */
export function buildValuationCalculation({
  snapshot,
  structured_result = {},
  subject = {},
  algorithm_version = VALUATION_CALC_VERSION,
} = {}) {
  if (!snapshot?.evidence_snapshot_id) {
    const err = new Error('VALUATION_CALC_REQUIRES_SNAPSHOT');
    err.code = 'VALUATION_CALC_REQUIRES_SNAPSHOT';
    throw err;
  }

  const included = (snapshot.eligibility?.included || []).filter(
    (e) => e.event_type === 'SALE_COMPLETED' || e.sale_kind === 'sold',
  );
  const eligible_sale_prices = included.map((e) => ({
    market_event_id: e.market_event_id || e.evidence_id,
    price: typeof e.price === 'number' ? e.price : Number(e.final_price ?? e.price_normalized),
    currency: e.currency || e.currency_normalized || structured_result.currency || 'USD',
  }));
  const normalized_prices = eligible_sale_prices
    .map((p) => p.price)
    .filter((n) => Number.isFinite(n));
  const med =
    typeof structured_result.fair_value === 'number' && structured_result.fair_value > 0
      ? null // fair_value is condition-adjusted; keep raw median separate
      : medianFn(normalized_prices);
  const rawMedian = medianFn(normalized_prices);
  const dispersion =
    normalized_prices.length >= 2 && rawMedian
      ? round2(
          (Math.max(...normalized_prices) - Math.min(...normalized_prices)) /
            Math.max(1, rawMedian),
        )
      : 0;

  const condition_adjustments = {
    condition: subject.condition || structured_result.condition_adjustment?.condition || null,
    multiplier: structured_result.condition_adjustment?.multiplier ?? 1,
    notes: subject.condition_notes || structured_result.condition_adjustment?.notes || null,
  };

  const outlier_decisions = (snapshot.excluded_event_ids || [])
    .filter((x) => x.decision === 'EXCLUDED_OUTLIER')
    .map((x) => ({ market_event_id: x.id, decision: x.decision, reason: x.reason }));

  const quick_sale_range =
    structured_result.quick_sale_range ||
    (structured_result.quick_sale_estimate
      ? {
          low: round2(structured_result.quick_sale_estimate * 0.95),
          high: round2(structured_result.quick_sale_estimate * 1.05),
        }
      : null);
  const fair_market_range =
    structured_result.fair_market_range ||
    (structured_result.low_estimate != null
      ? { low: structured_result.low_estimate, high: structured_result.high_estimate }
      : null);
  const patient_sale_range =
    structured_result.patient_sale_range ||
    (structured_result.patient_sale_estimate
      ? {
          low: round2(structured_result.patient_sale_estimate * 0.95),
          high: round2(structured_result.patient_sale_estimate * 1.08),
        }
      : null);

  const currency = structured_result.currency || 'USD';
  const payloadCore = {
    algorithm_version,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    currency,
    eligible_sale_prices,
    normalized_prices,
    time_range: snapshot.data_time_range || structured_result.time_range || {},
    condition_adjustments,
    outlier_decisions,
    median: rawMedian,
    dispersion,
    quick_sale_range,
    fair_market_range,
    patient_sale_range,
    sold_count: included.length,
    included_event_ids: included.map((e) => e.market_event_id || e.evidence_id).filter(Boolean),
    confidence_inputs: structured_result.confidence_factors || {},
    turn_id: snapshot.turn_id || null,
    request_id: snapshot.request_id || null,
  };
  const result_hash = sha256(payloadCore);
  const calculation_id = `calc-val-${result_hash.slice(0, 20)}`;

  return Object.freeze({
    calculation_id,
    capability: 'valuation',
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    algorithm_version,
    currency,
    eligible_sale_prices,
    normalized_prices,
    time_range: payloadCore.time_range,
    condition_adjustments,
    outlier_decisions,
    median: rawMedian,
    dispersion,
    quick_sale_range,
    fair_market_range,
    patient_sale_range,
    confidence_inputs: payloadCore.confidence_inputs,
    result_hash,
    payload: payloadCore,
    sold_count: included.length,
    included_event_ids: payloadCore.included_event_ids,
  });
}

/**
 * Material claims that must be claim-ledger verified for valuation delivery.
 */
export function buildValuationMaterialClaims(calculation) {
  if (!calculation?.calculation_id) {
    const err = new Error('VALUATION_CLAIMS_REQUIRE_CALCULATION');
    err.code = 'VALUATION_CLAIMS_REQUIRE_CALCULATION';
    throw err;
  }
  const ids = calculation.included_event_ids || [];
  const claims = [
    {
      claim_type: 'sold_count',
      normalized_claim_value: calculation.sold_count,
      expected_count: calculation.sold_count,
      supporting_snapshot_item_ids: ids,
      deterministic_calculation_id: calculation.calculation_id,
      synthesis_path: 'structured_result.sold_count',
      material: true,
    },
  ];

  // Subject/range claims require eligible settlement evidence; otherwise fail-closed
  // would reject honest abstentions that correctly report sold_count=0.
  if (!ids.length) return claims;

  claims.push({
    claim_type: 'currency',
    normalized_claim_value: calculation.currency,
    supporting_snapshot_item_ids: ids,
    deterministic_calculation_id: calculation.calculation_id,
    synthesis_path: 'structured_result.currency',
    material: true,
  });
  if (calculation.median != null) {
    claims.push({
      claim_type: 'median_sold_price',
      normalized_claim_value: calculation.median,
      supporting_snapshot_item_ids: ids,
      deterministic_calculation_id: calculation.calculation_id,
      synthesis_path: 'calculation.median',
      material: true,
    });
  }

  if (calculation.fair_market_range) {
    claims.push(
      {
        claim_type: 'fair_market_low',
        normalized_claim_value: calculation.fair_market_range.low,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.fair_market_range.low',
        material: true,
      },
      {
        claim_type: 'fair_market_high',
        normalized_claim_value: calculation.fair_market_range.high,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.fair_market_range.high',
        material: true,
      },
    );
  }
  if (calculation.quick_sale_range) {
    claims.push(
      {
        claim_type: 'quick_sale_low',
        normalized_claim_value: calculation.quick_sale_range.low,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.quick_sale_range.low',
        material: true,
      },
      {
        claim_type: 'quick_sale_high',
        normalized_claim_value: calculation.quick_sale_range.high,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.quick_sale_range.high',
        material: true,
      },
    );
  }
  if (calculation.patient_sale_range) {
    claims.push(
      {
        claim_type: 'patient_sale_low',
        normalized_claim_value: calculation.patient_sale_range.low,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.patient_sale_range.low',
        material: true,
      },
      {
        claim_type: 'patient_sale_high',
        normalized_claim_value: calculation.patient_sale_range.high,
        supporting_snapshot_item_ids: ids,
        deterministic_calculation_id: calculation.calculation_id,
        synthesis_path: 'structured_result.patient_sale_range.high',
        material: true,
      },
    );
  }
  if (calculation.condition_adjustments?.condition) {
    claims.push({
      claim_type: 'condition_adjustment',
      normalized_claim_value: calculation.condition_adjustments,
      supporting_snapshot_item_ids: ids,
      deterministic_calculation_id: calculation.calculation_id,
      synthesis_path: 'structured_result.condition_adjustment',
      material: true,
    });
  }
  if (calculation.time_range && (calculation.time_range.start || calculation.time_range.end)) {
    claims.push({
      claim_type: 'time_range',
      normalized_claim_value: calculation.time_range,
      supporting_snapshot_item_ids: ids,
      deterministic_calculation_id: calculation.calculation_id,
      synthesis_path: 'snapshot.data_time_range',
      material: true,
    });
  }

  return claims;
}

/**
 * Reject when displayed structured numbers disagree with the calculation record.
 */
export function assertValuationMatchesCalculation(structured_result, calculation) {
  const mismatches = [];
  if (!calculation) {
    mismatches.push('missing_calculation');
  } else {
    if (Number(structured_result?.sold_count) !== Number(calculation.sold_count)) {
      mismatches.push('sold_count');
    }
    if (
      structured_result?.currency &&
      String(structured_result.currency).toUpperCase() !== String(calculation.currency).toUpperCase()
    ) {
      mismatches.push('currency');
    }
    if (calculation.fair_market_range) {
      if (Number(structured_result?.low_estimate) !== Number(calculation.fair_market_range.low)) {
        mismatches.push('fair_market_low');
      }
      if (Number(structured_result?.high_estimate) !== Number(calculation.fair_market_range.high)) {
        mismatches.push('fair_market_high');
      }
    }
  }
  if (mismatches.length) {
    const err = new Error(`VALUATION_CALCULATION_MISMATCH:${mismatches.join(',')}`);
    err.code = 'VALUATION_CALCULATION_MISMATCH';
    err.mismatches = mismatches;
    throw err;
  }
  return true;
}
