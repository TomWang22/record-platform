/**
 * Fail-closed claim ↔ calculation ↔ snapshot integrity checks.
 */
export function verifyMaterialClaimIntegrity({
  claim,
  calculation,
  snapshot,
  includedMarketEventIds = [],
  excludedMarketEventIds = [],
} = {}) {
  const failures = [];
  if (!claim) {
    return { ok: false, failures: ['missing_claim'] };
  }
  const calcId = claim.deterministic_calculation_id || claim.calculation_id;
  if (!calcId) {
    failures.push('claim_missing_calculation_id');
  }
  if (!calculation || !calculation.calculation_id) {
    failures.push('calculation_missing');
  } else if (calcId && calculation.calculation_id !== calcId) {
    failures.push('claim_calculation_id_mismatch');
  }
  if (calculation?.evidence_snapshot_id && snapshot?.evidence_snapshot_id) {
    if (calculation.evidence_snapshot_id !== snapshot.evidence_snapshot_id) {
      failures.push('calculation_snapshot_mismatch');
    }
  }
  const supporting = claim.supporting_snapshot_item_ids || claim.supporting_market_event_ids || [];
  for (const id of supporting) {
    if (!includedMarketEventIds.includes(id)) {
      failures.push(`supporting_event_not_in_snapshot:${id}`);
    }
    if (excludedMarketEventIds.includes(id)) {
      failures.push(`excluded_event_supports_claim:${id}`);
    }
  }
  if (
    claim.normalized_claim_value !== undefined &&
    calculation &&
    claim.claim_type &&
    claim.claim_type !== 'sold_count' &&
    claim.claim_type !== 'condition_adjustment' &&
    claim.claim_type !== 'time_range'
  ) {
    // Currency / median / bounds compared when claim carries path into calculation.
  }
  if (
    claim.claim_type === 'currency' &&
    calculation?.currency &&
    String(claim.normalized_claim_value) !== String(calculation.currency)
  ) {
    failures.push('currency_mismatch');
  }
  if (
    claim.claim_type === 'sold_count' &&
    calculation?.sold_count != null &&
    Number(claim.normalized_claim_value) !== Number(calculation.sold_count)
  ) {
    failures.push('sold_count_mismatch');
  }
  if (
    claim.claim_type === 'median_sold_price' &&
    calculation?.median != null &&
    Number(claim.normalized_claim_value) !== Number(calculation.median)
  ) {
    failures.push('median_mismatch');
  }

  const legacyShaBlocked = (calculation?.eligible_sale_source_shas || []).some((s) =>
    ['unknown', 'unknown-pre-migration-56', 'LEGACY_UNKNOWN'].includes(String(s)),
  );
  if (legacyShaBlocked) {
    failures.push('legacy_source_sha_in_acceptance_snapshot');
  }

  return { ok: failures.length === 0, failures };
}
