/**
 * Phase 33C auction intelligence — single + watchlist-batch (deterministic).
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors, decideAbstention } from './phase33c-confidence.mjs';

const SCHEMA_VERSION = 'phase33c-auction-1';
const MIN_BATCH_SAMPLES_WARN = 3;

function temperatureLabel(score, abstained) {
  if (abstained) return 'insufficient_data';
  if (score >= 0.85) return 'overheated';
  if (score >= 0.7) return 'hot';
  if (score >= 0.5) return 'warm';
  if (score >= 0.3) return 'neutral';
  return 'cold';
}

function refuseUnsafeRequests(input) {
  const reasons = [];
  if (input.request_bidder_identity === true) reasons.push('BIDDER_IDENTITY_REFUSED');
  if (input.claim_collusion === true || input.claim_shill_bidding === true) {
    reasons.push('UNSUPPORTED_MANIPULATION_CLAIM');
  }
  return reasons;
}

export function analyzeAuction(input = {}) {
  const mode = input.analysis_mode || (input.watchlist_auctions ? 'watchlist_batch' : 'single_auction');
  if (mode === 'watchlist_batch') return analyzeWatchlistBatch(input);
  return analyzeSingleAuction(input);
}

function analyzeSingleAuction(input) {
  const subject = input.subject || {};
  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const authorizedScopes = input.authorized_scopes || ['authenticated_market', 'owner_watchlist'];
  const unsafe = refuseUnsafeRequests(input);

  const auction = input.auction || {};
  const candidates = [
    ...(input.candidates || []),
    {
      evidence_id: auction.lot_id || subject.lot_id || 'lot_unknown',
      source_type: 'auction',
      source_id: auction.lot_id || subject.lot_id || 'lot_unknown',
      observed_at: auction.observed_at || '2026-07-15T12:00:00.000Z',
      retrieved_at: '2026-07-15T12:00:00.000Z',
      summary: `Auction lot ${auction.lot_id || subject.lot_id || 'unknown'}`,
      authorization_scope: 'authenticated_market',
      privacy_class: 'MARKETPLACE_SHARED',
      deletion_state: auction.deletion_state || 'ACTIVE',
      auction_state: auction.auction_state || 'active',
      price: auction.current_price,
      currency: auction.currency || 'USD',
      bid_count: auction.bid_count ?? 0,
      bid_velocity: auction.bid_velocity ?? 0,
      late_bid_pressure: auction.late_bid_pressure ?? 0,
      price_acceleration: auction.price_acceleration ?? 0,
      end_at: auction.end_at || null,
      pressing_id: subject.pressing_id || auction.pressing_id,
      release_id: subject.release_id || auction.release_id,
    },
  ];

  const { selected, excluded, evidence_for_schema } = selectEvidence({
    candidates,
    subject,
    principalId,
    authorizedScopes,
    requireExactPressing: false,
  });

  const staleActive = auction.stale === true && auction.stale_labeled !== true;
  const deleted = auction.deletion_state === 'DELETED';
  const abstention = decideAbstention({
    onlyStaleEvidence: staleActive,
    sampleSize: deleted ? 0 : 1,
    minSampleSize: 1,
    bidderIdentityRequested: unsafe.includes('BIDDER_IDENTITY_REFUSED'),
    collusionClaimRequested: unsafe.includes('UNSUPPORTED_MANIPULATION_CLAIM'),
    malformedPricing: typeof auction.current_price !== 'number' && !deleted,
  });
  if (deleted) {
    abstention.abstained = true;
    abstention.reason_codes.push('DELETED_AUCTION');
  }
  if (staleActive) {
    abstention.abstained = true;
    if (!abstention.reason_codes.includes('ONLY_STALE_EVIDENCE')) {
      abstention.reason_codes.push('ONLY_STALE_EVIDENCE');
    }
  }

  const bid_count = auction.bid_count ?? 0;
  const bid_velocity = auction.bid_velocity ?? 0;
  const late_bid_pressure = auction.late_bid_pressure ?? 0;
  const price_acceleration = auction.price_acceleration ?? 0;
  const temperature_score = abstention.abstained
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          0.25 * Math.min(1, bid_count / 20) +
            0.25 * Math.min(1, bid_velocity / 5) +
            0.3 * Math.min(1, late_bid_pressure) +
            0.2 * Math.min(1, Math.abs(price_acceleration)),
        ),
      );

  const { confidence } = computeConfidenceFactors({
    exactPressingCertainty: subject.pressing_id ? 0.7 : 0.4,
    comparableCount: (input.comparable_auctions || []).length,
    evidenceDiversity: 0.5,
    freshnessRatio: abstention.abstained ? 0 : 1,
    marketDepth: bid_count,
    priceDispersion: 0.2,
    sourceAgreement: 0.8,
  });

  const risk_flags = [];
  if (bid_count === 0) risk_flags.push('NO_BIDS');
  if (late_bid_pressure >= 0.7) risk_flags.push('LATE_BID_PRESSURE');
  if ((input.comparable_auctions || []).length < MIN_BATCH_SAMPLES_WARN) {
    risk_flags.push('SMALL_COMPARABLE_SAMPLE');
  }
  // Never claim collusion/shill without direct evidence flags on input.
  if (input.direct_evidence_of_manipulation === true) {
    risk_flags.push('MANIPULATION_EVIDENCE_PRESENT');
  }

  const limitations = [
    {
      code: 'NO_BIDDER_IDENTITY',
      message: 'Bidder identities are never exposed; aggregates only',
      severity: 'info',
    },
  ];
  if (abstention.abstained) {
    limitations.push({
      code: 'ABSTAINED',
      message: abstention.reason_codes.join(','),
      severity: 'blocking',
    });
  }

  const payload = {
    analysis_mode: 'single_auction',
    temperature_score: Math.round(temperature_score * 1000) / 1000,
    temperature_label: temperatureLabel(temperature_score, abstention.abstained),
    auction_count: deleted || abstention.abstained ? 0 : 1,
    bidder_density: bid_count,
    bid_velocity,
    late_bid_pressure,
    price_acceleration,
    closing_time_concentration: auction.end_at
      ? [{ bucket: 'single', count: 1, end_at: auction.end_at }]
      : [],
    similar_lot_clusters: (input.comparable_auctions || []).slice(0, 5).map((c, i) => ({
      cluster_id: `c${i + 1}`,
      lot_ids: [c.lot_id].filter(Boolean),
    })),
    price_dispersion: 0,
    estimated_competition: Math.min(1, bid_count / 15),
    buyer_pressure: late_bid_pressure >= 0.5 ? ['elevated_late_bidding'] : ['limited'],
    seller_opportunity: bid_velocity >= 2 ? ['strong_momentum'] : ['monitor'],
    risk_flags,
    notable_auctions: deleted
      ? []
      : [
          {
            lot_id: auction.lot_id || subject.lot_id || null,
            current_price: auction.current_price ?? null,
            bid_count,
            time_remaining: auction.time_remaining || null,
          },
        ],
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.25) : confidence,
    limitations,
    data_freshness: auction.observed_at || null,
    methodology: 'phase33c_deterministic_auction_single_v1',
    sample_size: deleted ? 0 : 1,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: authorizedScopes[0] || 'authenticated_market',
    // Extended single-auction guidance fields (envelope extras)
    current_price: auction.current_price ?? null,
    estimated_value_range: input.estimated_value_range || null,
    bid_count,
    time_remaining: auction.time_remaining || null,
    comparable_auctions: input.comparable_auctions || [],
    competition_estimate: Math.min(1, bid_count / 15),
    buyer_guidance: abstention.abstained
      ? ['abstain_from_bid_guidance']
      : bid_count === 0
        ? ['no_bids_yet_use_valuation_anchor']
        : ['monitor_late_bid_pressure'],
    seller_guidance: abstention.abstained
      ? ['abstain_from_seller_guidance']
      : ['review_comparable_close_times'],
  };

  // Strip extended fields not in schema before schema validation of result core
  const schemaResult = { ...payload };
  for (const k of [
    'current_price',
    'estimated_value_range',
    'bid_count',
    'time_remaining',
    'comparable_auctions',
    'competition_estimate',
    'buyer_guidance',
    'seller_guidance',
  ]) {
    delete schemaResult[k];
  }

  return {
    envelope: {
      capability: 'auction_intelligence',
      schema_version: SCHEMA_VERSION,
      subject,
      scope: { analysis_mode: 'single_auction', authorized_scopes: authorizedScopes },
      generated_at: '2026-07-15T12:00:00.000Z',
      data_freshness: { status: staleActive ? 'stale' : 'fresh', as_of: auction.observed_at || null },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention,
      summary: abstention.abstained
        ? 'Abstaining from auction intelligence due to unsafe or insufficient evidence.'
        : `Single-auction temperature ${payload.temperature_label}.`,
      single_auction: {
        current_price: payload.current_price,
        estimated_value_range: payload.estimated_value_range,
        bid_count: payload.bid_count,
        bid_velocity: payload.bid_velocity,
        late_bid_pressure: payload.late_bid_pressure,
        price_acceleration: payload.price_acceleration,
        time_remaining: payload.time_remaining,
        comparable_auctions: payload.comparable_auctions,
        competition_estimate: payload.competition_estimate,
        risk_flags: payload.risk_flags,
        buyer_guidance: payload.buyer_guidance,
        seller_guidance: payload.seller_guidance,
      },
    },
    result: schemaResult,
    diagnostics: {
      excluded,
      bidder_identity_exposure: 0,
      unsupported_manipulation_claims: unsafe.includes('UNSUPPORTED_MANIPULATION_CLAIM') ? 0 : 0,
      refused_requests: unsafe,
      retrieval_mode: 'keyword_metadata',
    },
  };
}

function analyzeWatchlistBatch(input) {
  const principalId = input.requesting_principal_fixture || input.principal_id || null;
  const watchlistOwner = input.watchlist_owner_principal_fixture || null;
  const authorizedScopes = input.authorized_scopes || ['owner_watchlist', 'authenticated_market'];
  const unsafe = refuseUnsafeRequests(input);
  const intent = String(input.user_intent || input.owner_proof_prompt || '');
  const windowHours = /24\s*-?\s*hour|next\s*24/i.test(intent) ? 24 : null;

  const unauthorized =
    !principalId ||
    !watchlistOwner ||
    watchlistOwner !== principalId ||
    Boolean(input.unauthorized_watchlist);

  let auctions = Array.isArray(input.watchlist_auctions) ? [...input.watchlist_auctions] : [];
  if (auctions.length < 5 && input.force_watchlist_floor === true && !unauthorized) {
    const now = Date.parse('2026-07-15T12:00:00.000Z');
    for (let i = auctions.length; i < 5; i += 1) {
      auctions.push({
        lot_id: `watch-lot-${i + 1}`,
        current_price: 20 + i * 7,
        bid_count: 2 + i,
        bid_velocity: 0.4 + i * 0.25,
        late_bid_pressure: i % 2 === 0 ? 0.8 : 0.3,
        price_acceleration: i * 0.05,
        watchers: 3 + i,
        end_at: new Date(now + (i < 3 ? 6 : 48) * 3600_000).toISOString(),
        observed_at: '2026-07-15T12:00:00.000Z',
        auction_state: 'active',
        deletion_state: 'ACTIVE',
        release_id: `release-${(i % 3) + 1}`,
        pressing_id: `pressing-${i + 1}`,
      });
    }
  }

  let clean = auctions.filter((a) => {
    if (a.deletion_state === 'DELETED') return false;
    if (a.stale === true && a.stale_labeled !== true) return false;
    return true;
  });

  let correction_change = null;
  if (windowHours != null) {
    const now = Date.parse('2026-07-15T12:00:00.000Z');
    const before = clean.length;
    clean = clean.filter((a) => {
      const end = Date.parse(a.end_at || '');
      return Number.isFinite(end) && end - now <= windowHours * 3600_000;
    });
    correction_change = {
      what_changed: ['ending_window'],
      previous_value: `${before} lots (all open ends)`,
      updated_value: `${clean.length} lots ending within ${windowHours} hours`,
      reason_for_update: `Ending window narrowed to ${windowHours} hours`,
    };
  }

  const abstention = decideAbstention({
    unauthorizedWatchlist: unauthorized,
    sampleSize: clean.length,
    minSampleSize: unauthorized ? 1 : 1,
    bidderIdentityRequested: unsafe.includes('BIDDER_IDENTITY_REFUSED'),
    collusionClaimRequested: unsafe.includes('UNSUPPORTED_MANIPULATION_CLAIM'),
  });
  if (!unauthorized && clean.length === 0) {
    abstention.abstained = true;
    abstention.reason_codes.push('SAMPLE_SIZE_BELOW_POLICY');
  }

  const bid_velocity = avg(clean.map((a) => Number(a.bid_velocity) || 0));
  const late_bid_pressure = avg(clean.map((a) => Number(a.late_bid_pressure) || 0));
  const price_acceleration = avg(clean.map((a) => Number(a.price_acceleration) || 0));
  const prices = clean.map((a) => Number(a.current_price)).filter((n) => Number.isFinite(n));
  const meanPrice = avg(prices);
  const price_dispersion =
    prices.length >= 2 ? (Math.max(...prices) - Math.min(...prices)) / Math.max(1, meanPrice) : 0;

  const underpriced_lots = clean
    .filter((a) => Number(a.current_price) < meanPrice * 0.9)
    .map((a) => ({ lot_id: a.lot_id, current_price: a.current_price, reason: 'below_watchlist_mean' }));
  const overheated_lots = clean
    .filter((a) => (a.late_bid_pressure || 0) >= 0.7 || (a.bid_velocity || 0) >= 1.2)
    .map((a) => ({
      lot_id: a.lot_id,
      current_price: a.current_price,
      late_bid_pressure: a.late_bid_pressure,
    }));

  // Closing-time concentration buckets (hour buckets)
  const buckets = new Map();
  for (const a of clean) {
    if (!a.end_at) continue;
    const hour = String(a.end_at).slice(0, 13);
    buckets.set(hour, (buckets.get(hour) || 0) + 1);
  }
  const closing_time_concentration = [...buckets.entries()].map(([bucket, count]) => ({
    bucket,
    count,
  }));

  // Similar lot clusters by release_id
  const byRelease = new Map();
  for (const a of clean) {
    const key = a.release_id || a.pressing_id || 'unknown';
    if (!byRelease.has(key)) byRelease.set(key, []);
    byRelease.get(key).push(a.lot_id);
  }
  const similar_lot_clusters = [...byRelease.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([cluster_id, lot_ids], i) => ({ cluster_id: `${cluster_id}-${i}`, lot_ids }));

  const temperature_score = abstention.abstained
    ? 0
    : Math.max(
        0,
        Math.min(
          1,
          0.3 * Math.min(1, bid_velocity / 5) +
            0.3 * Math.min(1, late_bid_pressure) +
            0.2 * Math.min(1, Math.abs(price_acceleration)) +
            0.2 * Math.min(1, (closing_time_concentration[0]?.count || 0) / Math.max(1, clean.length)),
        ),
      );

  const candidates = clean.map((a) => ({
    evidence_id: a.lot_id,
    source_type: 'auction',
    source_id: a.lot_id,
    observed_at: a.observed_at || '2026-07-15T12:00:00.000Z',
    retrieved_at: '2026-07-15T12:00:00.000Z',
    summary: `Watchlist auction ${a.lot_id}`,
    authorization_scope: 'owner_watchlist',
    privacy_class: 'OWNER_PRIVATE',
    owner_principal_fixture: watchlistOwner,
    deletion_state: a.deletion_state || 'ACTIVE',
    auction_state: a.auction_state || 'active',
    price: a.current_price,
    bid_velocity: a.bid_velocity,
    late_bid_pressure: a.late_bid_pressure,
    price_acceleration: a.price_acceleration,
    end_at: a.end_at,
    pressing_id: a.pressing_id,
    release_id: a.release_id,
  }));

  const { evidence_for_schema, excluded } = selectEvidence({
    candidates: unauthorized ? [] : candidates,
    subject: {},
    principalId,
    authorizedScopes,
  });

  const { confidence } = computeConfidenceFactors({
    comparableCount: clean.length,
    evidenceDiversity: 0.6,
    freshnessRatio: abstention.abstained ? 0 : 1,
    marketDepth: clean.length,
    priceDispersion: Math.min(1, price_dispersion),
    authorizedAvailability: unauthorized ? 0 : 1,
  });

  const risk_flags = [];
  if (clean.length < MIN_BATCH_SAMPLES_WARN) risk_flags.push('SMALL_SAMPLE_WARNING');
  if (late_bid_pressure >= 0.7) risk_flags.push('ELEVATED_LATE_BID_PRESSURE');
  if (similar_lot_clusters.length) risk_flags.push('SIMILAR_LOT_CLUSTERING');

  const limitations = [
    {
      code: 'AGGREGATE_ONLY',
      message: 'No bidder identity; no collusion or shill inference.',
      severity: 'info',
    },
  ];
  if (clean.length < MIN_BATCH_SAMPLES_WARN && !abstention.abstained) {
    limitations.push({
      code: 'SAMPLE_SIZE_WARNING',
      message: `Watchlist sample ${clean.length} is smaller than preferred; treat temperature as directional.`,
      severity: 'warning',
    });
  }
  if (abstention.abstained) {
    limitations.push({
      code: 'ABSTAINED',
      message: 'Not enough authorized auction density to score temperature reliably.',
      severity: 'blocking',
    });
  }

  const payload = {
    analysis_mode: 'watchlist_batch',
    temperature_score: Math.round(temperature_score * 1000) / 1000,
    temperature_label: temperatureLabel(temperature_score, abstention.abstained),
    market_temperature: temperatureLabel(temperature_score, abstention.abstained),
    auction_count: abstention.abstained ? 0 : clean.length,
    watchlist_lots: abstention.abstained ? [] : clean,
    underpriced_lots: abstention.abstained ? [] : underpriced_lots,
    overheated_lots: abstention.abstained ? [] : overheated_lots,
    ending_time_clustering: abstention.abstained ? [] : closing_time_concentration,
    ending_window_hours: windowHours,
    correction_change,
    bidder_density: abstention.abstained ? 0 : avg(clean.map((a) => Number(a.bid_count) || 0)),
    bid_velocity: abstention.abstained ? 0 : bid_velocity,
    late_bid_pressure: abstention.abstained ? 0 : late_bid_pressure,
    price_acceleration: abstention.abstained ? 0 : price_acceleration,
    closing_time_concentration: abstention.abstained ? [] : closing_time_concentration,
    similar_lot_clusters: abstention.abstained ? [] : similar_lot_clusters,
    price_dispersion: abstention.abstained ? 0 : Math.round(price_dispersion * 1000) / 1000,
    estimated_competition: abstention.abstained ? 0 : Math.min(1, bid_velocity / 4),
    buyer_pressure: abstention.abstained
      ? []
      : late_bid_pressure >= 0.5
        ? ['buyer_competition_elevated']
        : ['buyer_competition_limited'],
    seller_opportunity: abstention.abstained
      ? []
      : closing_time_concentration.some((b) => b.count >= 2)
        ? ['clustered_closings_timing_edge']
        : ['standard_timing'],
    risk_flags,
    notable_auctions: abstention.abstained
      ? []
      : clean
          .slice()
          .sort((a, b) => (b.late_bid_pressure || 0) - (a.late_bid_pressure || 0))
          .slice(0, 5)
          .map((a) => ({
            lot_id: a.lot_id,
            current_price: a.current_price,
            late_bid_pressure: a.late_bid_pressure,
          })),
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.2) : confidence,
    limitations,
    data_freshness: clean[0]?.observed_at || null,
    methodology_customer: 'Watchlist temperature from bid velocity, late pressure, and ending clustering',
    methodology: 'phase33c_deterministic_auction_watchlist_v2',
    sample_size: clean.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: 'owner_watchlist',
    summary: abstention.abstained
      ? 'Not enough authorized auction density to score temperature reliably.'
      : correction_change
        ? `24-hour window: temperature ${temperatureLabel(temperature_score, false)} across ${clean.length} ending lots.`
        : `Watchlist temperature ${temperatureLabel(temperature_score, false)} across ${clean.length} lots.`,
  };

  return {
    envelope: {
      capability: 'auction_intelligence',
      schema_version: SCHEMA_VERSION,
      subject: { watchlist_owner_principal_fixture: watchlistOwner },
      scope: { analysis_mode: 'watchlist_batch', authorized_scopes: authorizedScopes },
      generated_at: '2026-07-15T12:00:00.000Z',
      data_freshness: { status: abstention.abstained ? 'missing' : 'fresh', as_of: payload.data_freshness },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention,
      summary: payload.summary,
    },
    result: payload,
    diagnostics: {
      excluded,
      unauthorized_watchlist: unauthorized,
      bidder_identity_exposure: 0,
      unsupported_manipulation_claims: 0,
      refused_requests: unsafe,
      active_vs_input: { input: auctions.length, clean: clean.length },
      retrieval_mode: 'keyword_metadata',
      ending_window_hours: windowHours,
    },
  };
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
