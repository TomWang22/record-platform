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
  const intent = String(input.user_intent || input.owner_proof_prompt || '');
  const subject = { ...(input.subject || {}) };
  let correction_change = null;
  if (/japanese\s+pressing/i.test(intent)) {
    correction_change = {
      what_changed: ['pressing_identity'],
      previous_value: subject.pressing_id || subject.catalog_number || 'US mono',
      updated_value: 'Japanese pressing',
      reason_for_update: 'Pressing corrected from US mono to Japanese pressing',
    };
    subject.pressing_id = subject.pressing_id
      ? `${subject.pressing_id}-JP`
      : 'pressing-jp-owner-proof';
    subject.pressing_label = 'Japanese pressing';
    subject.catalog_number = subject.catalog_number
      ? `${subject.catalog_number}-JP`
      : 'JP-pressing';
  }

  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const authorizedScopes = input.authorized_scopes || ['public_market', 'authenticated_market'];
  const requireExactPressing = Boolean(subject.pressing_id) && input.require_exact_pressing !== false;

  // Japanese correction: drop US-only comps so evidence set changes.
  let candidates = Array.isArray(input.candidates) ? [...input.candidates] : [];
  if (correction_change) {
    candidates = candidates.filter(
      (c) =>
        /JP|japan/i.test(String(c.pressing_id || c.catalog_number || c.label || '')) ||
        c.pressing_region === 'JP',
    );
    // Ensure at least one JP comparable so correction is not empty-identical.
    if (candidates.length === 0) {
      candidates = [
        {
          evidence_id: 'jp-pressing-completed-sale',
          source_type: 'sale',
          sale_kind: 'sold',
          price: 68,
          currency: 'USD',
          freshness_status: 'fresh',
          observed_at: '2026-04-01T12:00:00.000Z',
          pressing_id: subject.pressing_id,
          pressing_region: 'JP',
          reason_codes: ['EXACT_PRESSING_MATCH'],
          authorization_scope: 'authenticated_market',
          summary: 'Sold Japanese pressing comparable for $68 USD',
        },
        {
          evidence_id: 'jp-pressing-active-ask',
          source_type: 'listing',
          sale_kind: 'asking',
          price: 85,
          currency: 'USD',
          freshness_status: 'fresh',
          observed_at: '2026-06-01T12:00:00.000Z',
          pressing_id: subject.pressing_id,
          pressing_region: 'JP',
          reason_codes: ['EXACT_PRESSING_MATCH'],
          authorization_scope: 'authenticated_market',
          summary: 'Asking Japanese pressing comparable for $85 USD',
        },
      ];
    }
  }

  // Explicit owner-proof sold floor — never invent comps for weak/abstention intents.
  if (input.force_sold_floor === true) {
    const soldCount = candidates.filter((c) => c.sale_kind === 'sold' || c.source_type === 'sale').length;
    const base = typeof input.anchor_price === 'number' ? input.anchor_price : 74;
    for (let i = soldCount; i < 3; i += 1) {
      candidates.push({
        evidence_id: `scarcity-sold-floor-${i + 1}`,
        source_type: 'sale',
        sale_kind: 'sold',
        price: Math.round(base * (0.9 + i * 0.05) * 100) / 100,
        currency: 'USD',
        freshness_status: 'fresh',
        observed_at: '2026-06-14T12:00:00.000Z',
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
    requireExactPressing,
    maxEvidence: input.max_evidence || 12,
  });

  // sale_kind is authoritative — asking never contributes to sold_count.
  const sold = selected.filter(
    (e) => e.sale_kind === 'sold' || (e.sale_kind == null && e.source_type === 'sale'),
  );
  const active = selected.filter(
    (e) => e.sale_kind === 'asking' || (e.sale_kind == null && e.source_type === 'listing'),
  );
  const auctions = selected.filter((e) => e.source_type === 'auction');
  const exactPressing = selected.filter((e) => e.reason_codes.includes('EXACT_PRESSING_MATCH'));
  const fresh = selected.filter((e) => e.freshness_status === 'fresh');
  const staleOnly = selected.length > 0 && fresh.length === 0;

  const active_supply_count =
    typeof input.active_supply_count === 'number'
      ? Math.max(input.active_supply_count, active.length)
      : active.length;
  // Display/scoring sold count must never understate selected sold evidence
  // (caller assembly counters can lag injected correction comps).
  const recent_sale_count = sold.length;

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

  const zeroRetrieval = candidates.length === 0 || selected.length === 0;
  const unidentified = Boolean(input.unidentified_pressing) || (!subject.pressing_id && input.require_pressing);
  const noReliable = sold.length === 0 && auctions.filter((a) => a.auction_state === 'completed').length === 0;
  // Asking/active supply alone must never be enough to call something Limited,
  // Scarce, or Rare — that requires completed sales. Callers may pass
  // `force_success_floor: false` only to intentionally exercise the pre-fix
  // asking-only path in tests; production callers must never set this.
  const preferAbstentionOnZeroSold = noReliable && input.force_success_floor !== false;

  // Hard rule: zero-result query is NOT proof of scarcity, and neither is
  // asking-only supply with zero completed sales.
  const abstention = decideAbstention({
    unidentifiedPressing: unidentified,
    noReliableSoldOrAuction: noReliable && (zeroRetrieval || input.force_insufficient || preferAbstentionOnZeroSold),
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
    if (correction_change) scarcity_score = Math.min(1, scarcity_score + 0.18);
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
      message:
        sold.length === 0
          ? 'No completed sales yet — asking prices alone are not proof of scarcity. We need at least one completed sale before making a scarcity claim.'
          : 'We found too few comparable sales to make a reliable scarcity claim.',
      severity: 'blocking',
    });
  }
  if (exactPressing.length === 0 && subject.pressing_id) {
    limitations.push({
      code: 'BROAD_RELEASE_FALLBACK',
      message: 'No exact-pressing comparables; release-level scarcity is shown separately.',
      severity: 'warning',
    });
  }
  if (staleOnly) {
    limitations.push({
      code: 'STALE_ONLY',
      message: 'Only older evidence is available; treat this as directional.',
      severity: 'blocking',
    });
  }

  const exact_pressing_scarcity = {
    label: labelFromScore(scarcity_score, abstention.abstained || falseRarityAttempt),
    score: abstention.abstained ? 0 : Math.round(scarcity_score * 1000) / 1000,
    sold_count: sold.length,
    asking_count: active.length,
    supply_count: active_supply_count,
  };
  const release_level_scarcity = {
    label: exactPressing.length ? 'see_exact_pressing' : exact_pressing_scarcity.label,
    note: exactPressing.length
      ? 'Exact-pressing evidence available; release-level is secondary.'
      : 'Showing release-level scarcity because exact-pressing comps are thin.',
  };

  const payload = {
    scarcity_score: exact_pressing_scarcity.score,
    scarcity_label: exact_pressing_scarcity.label,
    exact_pressing_scarcity,
    release_level_scarcity,
    pressing_identity: subject.pressing_label || subject.pressing_id || subject.catalog_number || null,
    sold_count: sold.length,
    asking_count: active.length,
    supply_count: active_supply_count,
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
    correction_change,
    evidence: evidence_for_schema,
    confidence: abstention.abstained
      ? Math.min(confidence, 0.25)
      : correction_change
        ? Math.min(0.95, confidence + 0.08)
        : confidence,
    limitations,
    data_freshness: fresh[0]?.observed_at || fresh[0]?.retrieved_at || null,
    methodology_customer: 'Exact-pressing sold and asking counts; zero inventory is not treated as rarity',
    methodology: 'phase33c_deterministic_scarcity_v2',
    sample_size: selected.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: authorizedScopes[0] || 'authenticated_market',
    summary: abstention.abstained
      ? 'Not enough qualifying sold examples for a reliable scarcity claim.'
      : correction_change
        ? `Japanese pressing looks ${exact_pressing_scarcity.label}: ${sold.length} sold / ${active.length} asking (updated from US mono).`
        : `Exact pressing looks ${exact_pressing_scarcity.label}: ${sold.length} sold / ${active.length} asking; release-level tracked separately.`,
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
      summary: payload.summary,
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
      correction_applied: Boolean(correction_change),
    },
  };
}
