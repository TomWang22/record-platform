/**
 * Phase 33C deterministic confidence + abstention policy.
 * Confidence is never LLM-generated.
 */

export function computeConfidenceFactors({
  exactPressingCertainty = 0,
  comparableCount = 0,
  evidenceDiversity = 0,
  freshnessRatio = 1,
  conditionConfidence = 0.5,
  marketDepth = 0,
  priceDispersion = 0,
  sourceAgreement = 0.5,
  authorizedAvailability = 1,
} = {}) {
  const factors = {
    exact_pressing_certainty: clamp01(exactPressingCertainty),
    comparable_count_score: clamp01(comparableCount / 8),
    evidence_diversity: clamp01(evidenceDiversity),
    freshness_ratio: clamp01(freshnessRatio),
    condition_confidence: clamp01(conditionConfidence),
    market_depth_score: clamp01(marketDepth / 20),
    price_dispersion_penalty: clamp01(1 - Math.min(1, priceDispersion)),
    source_agreement: clamp01(sourceAgreement),
    authorized_availability: clamp01(authorizedAvailability),
  };
  const confidence =
    0.22 * factors.exact_pressing_certainty +
    0.18 * factors.comparable_count_score +
    0.12 * factors.evidence_diversity +
    0.12 * factors.freshness_ratio +
    0.1 * factors.condition_confidence +
    0.08 * factors.market_depth_score +
    0.08 * factors.price_dispersion_penalty +
    0.05 * factors.source_agreement +
    0.05 * factors.authorized_availability;
  return { confidence: round3(clamp01(confidence)), factors };
}

export function decideAbstention({
  unidentifiedPressing = false,
  noReliableSoldOrAuction = false,
  onlyStaleEvidence = false,
  contradictoryCondition = false,
  unauthorizedWatchlist = false,
  sampleSize = 0,
  minSampleSize = 1,
  evidenceDisagreement = 0,
  disagreementThreshold = 0.85,
  malformedPricing = false,
  zeroResultClaimedAsScarce = false,
  bidderIdentityRequested = false,
  collusionClaimRequested = false,
} = {}) {
  const reason_codes = [];
  if (unidentifiedPressing) reason_codes.push('UNIDENTIFIED_PRESSING');
  if (noReliableSoldOrAuction) reason_codes.push('NO_RELIABLE_SOLD_OR_AUCTION');
  if (onlyStaleEvidence) reason_codes.push('ONLY_STALE_EVIDENCE');
  if (contradictoryCondition) reason_codes.push('CONTRADICTORY_CONDITION');
  if (unauthorizedWatchlist) reason_codes.push('UNAUTHORIZED_WATCHLIST');
  if (sampleSize < minSampleSize) reason_codes.push('SAMPLE_SIZE_BELOW_POLICY');
  if (evidenceDisagreement > disagreementThreshold) reason_codes.push('EVIDENCE_DISAGREEMENT');
  if (malformedPricing) reason_codes.push('MALFORMED_PRICING_CURRENCY');
  if (zeroResultClaimedAsScarce) reason_codes.push('ZERO_RESULT_NOT_SCARCITY');
  if (bidderIdentityRequested) reason_codes.push('BIDDER_IDENTITY_REFUSED');
  if (collusionClaimRequested) reason_codes.push('UNSUPPORTED_MANIPULATION_CLAIM');
  return {
    abstained: reason_codes.length > 0,
    reason_codes,
  };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
