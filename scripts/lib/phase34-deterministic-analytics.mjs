/**
 * Phase E3 — deterministic analytics helpers for claim-ledger calc:* IDs.
 * Capability engines remain authoritative; these are shared primitives only.
 * MODEL_WEIGHT_TRAINING remains NO — no learned weights here.
 */

export const CALC_IDS = Object.freeze({
  MEDIAN: 'calc:median',
  COUNT: 'calc:count',
  PERCENT_CHANGE: 'calc:percent_change',
  MEAN: 'calc:mean',
  SUM: 'calc:sum',
});

function toFiniteNumbers(values) {
  return (Array.isArray(values) ? values : [])
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((n) => Number.isFinite(n));
}

/**
 * Median of numeric values. Returns null for empty input.
 * Even-length: average of two middle values, rounded to 2 decimals.
 */
export function median(values) {
  const nums = toFiniteNumbers(values).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
}

/**
 * Count of values (optionally filtered by predicate).
 */
export function count(values, predicate = null) {
  const arr = Array.isArray(values) ? values : [];
  if (typeof predicate === 'function') return arr.filter(predicate).length;
  return arr.length;
}

/**
 * Percent change from prior → current.
 * Returns null if prior is 0/null/undefined or either side non-finite.
 * Rounded to 1 decimal place.
 */
export function percentChange(prior, current) {
  const p = typeof prior === 'number' ? prior : Number(prior);
  const c = typeof current === 'number' ? current : Number(current);
  if (!Number.isFinite(p) || !Number.isFinite(c) || p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

export function mean(values) {
  const nums = toFiniteNumbers(values);
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export function sum(values) {
  const nums = toFiniteNumbers(values);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
}

/**
 * Run named calc:* helpers and return ledger-ready calculation records.
 */
export function runCalculations(calculationIds = [], context = {}) {
  const results = [];
  for (const id of calculationIds) {
    let value = null;
    let inputs = {};
    switch (id) {
      case CALC_IDS.MEDIAN:
      case 'calc:median':
        inputs = { values: context.values || context.prices || [] };
        value = median(inputs.values);
        break;
      case CALC_IDS.COUNT:
      case 'calc:count':
        inputs = { values: context.values || context.items || [] };
        value = count(inputs.values, context.predicate || null);
        break;
      case CALC_IDS.PERCENT_CHANGE:
      case 'calc:percent_change':
        inputs = { prior: context.prior, current: context.current };
        value = percentChange(inputs.prior, inputs.current);
        break;
      case CALC_IDS.MEAN:
      case 'calc:mean':
        inputs = { values: context.values || context.prices || [] };
        value = mean(inputs.values);
        break;
      case CALC_IDS.SUM:
      case 'calc:sum':
        inputs = { values: context.values || context.prices || [] };
        value = sum(inputs.values);
        break;
      default:
        results.push({
          deterministic_calculation_id: id,
          value: null,
          ok: false,
          reason: 'UNKNOWN_CALC_ID',
        });
        continue;
    }
    results.push({
      deterministic_calculation_id: id,
      value,
      ok: value != null,
      inputs,
    });
  }
  return results;
}

/**
 * Build claim-ledger supporting entries for calc results.
 */
export function calcClaimSupport(calculationResults = []) {
  return calculationResults
    .filter((r) => r.ok)
    .map((r) => ({
      claim_type: r.deterministic_calculation_id.replace(/^calc:/, ''),
      normalized_claim_value: r.value,
      supporting_snapshot_item_ids: [r.deterministic_calculation_id],
      deterministic_calculation_id: r.deterministic_calculation_id,
      material: true,
    }));
}

export default {
  median,
  count,
  percentChange,
  mean,
  sum,
  runCalculations,
  calcClaimSupport,
  CALC_IDS,
};
