/**
 * Phase 33C scarcity intelligence — deterministic metadata/evidence engine.
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors, decideAbstention } from './phase33c-confidence.mjs';

const SCHEMA_VERSION = 'phase33c-scarcity-1';

function labelFromScore(score, abstained) {
  if (abstained) return 'insufficient_data';
  if (score >= 0.9) return 'exceptional';
  if (score >= 0.75) return 'rare';
  if (score >= 0.55) return 'scarce';
  if (score >= 0.35) return 'limited';
  return 'common';
}

export function analyzeScarcity(input = {}) {
  const subject = input.subject || {};
  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const authorizedScopes = input.authorized_scopes || ['public_market', 'authenticated_market'];
  const requireExactPressing = Boolean(subject.pressing_id) && input.require_exact_pressing !== false;

  const { selected, excluded, evidence_for_schema } = selectEvidence({
    candidates: input.candidates || [],
    subject,
    principalId,
    authorizedScopes,
    requireExactPressing,
    maxEvidence: input.max_evidence || 12,
  });

  const sold = selected.filter((e) => e.sale_kind === 'sold' || e.source_type === 'sale');
  const active = selected.filter((e) => e.sale_kind === 'asking' || e.source_type === 'listing');
  const auctions = selected.filter((e) => e.source_type === 'auction');
  const exactPressing = selected.filter((e) => e.reason_codes.includes('EXACT_PRESSING_MATCH'));
  const fresh = selected.filter((e) => e.freshness_status === 'fresh');
  const staleOnly = selected.length > 0 && fresh.length === 0;

  const active_supply_count = typeof input.active_supply_count === 'number'
    ? input.active_supply_count
    : active.length;
  const recent_sale_count = typeof input.recent_sale_count === 'number'
    ? input.recent_sale_count
    : sold.length;

  const days_since_comparable_sale = sold.length
    ? Math.min(
        ...sold.map((e) => {
          const t = Date.parse(e.observed_at || e.retrieved_at);
          return Number.isFinite(t)
            ? Math.max(0, (Date.parse('2026-07-15T12:00:00.000Z') - t) / 86400000)
            : 365;
        }),
      )
    : null;

  const zeroRetrieval = (input.candidates || []).length === 0 || selected.length === 0;
  const unidentified = Boolean(input.unidentified_pressing) || (!subject.pressing_id && input.require_pressing);
  const noReliable = sold.length === 0 && auctions.filter((a) => a.auction_state === 'completed').length === 0;

  // Hard rule: zero-result query is NOT proof of scarcity.
  const abstention = decideAbstention({
    unidentifiedPressing: unidentified,
    noReliableSoldOrAuction: noReliable && (zeroRetrieval || input.force_insufficient),
    onlyStaleEvidence: staleOnly,
    contradictoryCondition: Boolean(input.contradictory_condition),
    sampleSize: sold.length + active.length + auctions.length,
    minSampleSize: input.min_sample_size ?? 1,
    zeroResultClaimedAsScarce: Boolean(input.claim_rarity_from_zero_results),
    malformedPricing: Boolean(input.malformed_pricing),
  });

  // If caller tries to claim rarity from zero results alone, force abstention + hard failure flag.
  const falseRarityAttempt = Boolean(input.claim_rarity_from_zero_results) && zeroRetrieval;

  let scarcity_score = 0;
  if (!abstention.abstained) {
    const supplyFactor = 1 / (1 + active_supply_count);
    const saleFactor = 1 / (1 + recent_sale_count);
    const depthPenalty = Math.min(1, (active_supply_count + recent_sale_count) / 30);
    scarcity_score = Math.max(0, Math.min(1, 0.55 * supplyFactor + 0.45 * saleFactor - 0.15 * depthPenalty));
    if (exactPressing.length === 0 && subject.pressing_id) scarcity_score *= 0.7;
  }

  const market_depth = active_supply_count + recent_sale_count;
  const supply_velocity = recent_sale_count / Math.max(1, (days_since_comparable_sale || 90) / 30);

  const { confidence, factors } = computeConfidenceFactors({
    exactPressingCertainty: subject.pressing_id
      ? exactPressing.length / Math.max(1, selected.length)
      : 0.4,
    comparableCount: sold.length,
    evidenceDiversity: new Set(selected.map((e) => e.source_type)).size / 4,
    freshnessRatio: selected.length ? fresh.length / selected.length : 0,
    conditionConfidence: input.condition_confidence ?? 0.5,
    marketDepth: market_depth,
    priceDispersion: input.price_dispersion ?? 0.2,
    sourceAgreement: input.source_agreement ?? 0.7,
    authorizedAvailability: 1,
  });

  const limitations = [];
  if (abstention.abstained) {
    limitations.push({
      code: 'ABSTAINED',
      message: `Insufficient evidence for scarcity claim: ${abstention.reason_codes.join(',')}`,
      severity: 'blocking',
    });
  }
  if (exactPressing.length === 0 && subject.pressing_id) {
    limitations.push({
      code: 'BROAD_RELEASE_FALLBACK',
      message: 'No exact-pressing comparables; scope may be release-level only',
      severity: 'warning',
    });
  }
  if (staleOnly) {
    limitations.push({
      code: 'STALE_ONLY',
      message: 'Only stale evidence available',
      severity: 'blocking',
    });
  }
  limitations.push({
    code: 'RETRIEVAL_MODE',
    message: 'Deterministic metadata/keyword evidence selection; semantic/hybrid not production defaults',
    severity: 'info',
  });

  const payload = {
    scarcity_score: abstention.abstained ? 0 : Math.round(scarcity_score * 1000) / 1000,
    scarcity_label: labelFromScore(scarcity_score, abstention.abstained || falseRarityAttempt),
    active_supply_count,
    recent_sale_count,
    days_since_comparable_sale,
    supply_velocity: Math.round(supply_velocity * 1000) / 1000,
    market_depth,
    comparable_scope: subject.pressing_id && exactPressing.length
      ? ['exact_pressing']
      : subject.release_id
        ? ['release']
        : ['comparable_group'],
    scope: subject.pressing_id && exactPressing.length ? 'pressing' : subject.release_id ? 'release' : 'comparable_group',
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.25) : confidence,
    limitations,
    data_freshness: fresh[0]?.observed_at || fresh[0]?.retrieved_at || null,
    methodology: 'phase33c_deterministic_scarcity_v1',
    sample_size: selected.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: authorizedScopes[0] || 'authenticated_market',
  };

  return {
    envelope: {
      capability: 'scarcity',
      schema_version: SCHEMA_VERSION,
      subject,
      scope: { authorized_scopes: authorizedScopes, comparable_scope: payload.comparable_scope },
      generated_at: '2026-07-15T12:00:00.000Z',
      data_freshness: {
        status: staleOnly ? 'stale' : selected.length ? 'fresh' : 'missing',
        as_of: payload.data_freshness,
      },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention,
      summary: abstention.abstained
        ? 'Abstaining from scarcity claim due to insufficient or unsafe evidence.'
        : `Scarcity labeled ${payload.scarcity_label} using deterministic sold/active supply evidence.`,
    },
    result: payload,
    diagnostics: {
      excluded,
      factors,
      false_rarity_attempt: falseRarityAttempt,
      wrong_pressing_exact_claims: selected.filter(
        (e) => e.reason_codes.includes('WRONG_PRESSING') && e.claim_exact_pressing,
      ).length,
      retrieval_mode: 'keyword_metadata',
    },
  };
}
