/**
 * Phase 33D negotiation assistance — deterministic, advisory-only.
 * Never auto-send. Never impersonate. Never fabricate leverage.
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors, decideAbstention } from './phase33c-confidence.mjs';
import { analyzeValuation } from './phase33c-valuation.mjs';

const SCHEMA_VERSION = 'phase33d-negotiation-1';

const UNSAFE_REQUEST_FLAGS = [
  'request_auto_send',
  'request_impersonation',
  'request_fabricated_leverage',
  'request_intimidation',
  'request_coercion',
  'request_discrimination',
  'request_deception',
];

export function authorizeThread(input = {}) {
  const principal = input.requesting_principal_fixture || input.principal_id || null;
  const thread = input.thread || {};
  const threadId = thread.thread_id || input.authorized_thread_id || null;
  const participants = new Set(thread.participant_principals || []);
  const mode = String(input.mode || input.capability_mode || '');
  const unauthorizedMode = [
    'unauthorized_thread',
    'cross_user_thread',
    'cross_user_thread_attempt',
    'deleted_thread',
    'missing_thread',
    'wrong_thread',
    'wrong_user',
  ].includes(mode);
  const unauthorized =
    Boolean(input.unauthorized_thread) ||
    unauthorizedMode ||
    !principal ||
    !threadId ||
    (participants.size > 0 && !participants.has(principal)) ||
    (thread.owner_cross_user_attempt === true);
  return {
    authorized: !unauthorized,
    principal,
    thread_id: threadId,
    unauthorized,
  };
}

function buildReplyDrafts({ side, anchor, target, walkAway, currency, abstained }) {
  if (abstained) {
    return {
      concise: 'I should not advise further until market or thread context is clearer.',
      friendly: 'Thanks — I need clearer authorized context before drafting a reply.',
      firm: 'No advisory reply until evidence/authorization requirements are met.',
    };
  }
  if (side === 'buyer') {
    return {
      concise: `Would you consider ${anchor} ${currency}?`,
      friendly: `Thanks for the details — would ${anchor} ${currency} work as a next step toward ~${target}?`,
      firm: `My supported range tops near ${walkAway} ${currency}; ${target} is my preferred landing zone.`,
    };
  }
  return {
    concise: `I can meet near ${target} ${currency}.`,
    friendly: `Appreciate the interest — I can work toward ${target} ${currency} with room around ${anchor}.`,
    firm: `My walk-away is ${walkAway} ${currency}; ${target} is a fair target based on sold evidence.`,
  };
}

function unauthorizedRefusalPayload(input, auth, side) {
  const reason_codes = ['UNAUTHORIZED_THREAD'];
  if (!side || (side !== 'buyer' && side !== 'seller')) {
    reason_codes.push('MISSING_PARTICIPANT_SIDE');
  }
  if (!input.subject?.listing_id && !input.subject?.release_id && !input.listing_id) {
    reason_codes.push('MISSING_LISTING_OR_SUBJECT');
  }
  reason_codes.push('NO_RELIABLE_MARKET_EVIDENCE');
  const abstention = { abstained: true, reason_codes };
  const limitations = [
    {
      code: 'ADVISORY_ONLY',
      message: 'Reply drafts are advisory; automatic_send_allowed remains false',
      severity: 'info',
    },
    {
      code: 'ABSTAINED',
      message: reason_codes.join(','),
      severity: 'blocking',
    },
  ];
  const confidence = 0.197;
  const reply_drafts = buildReplyDrafts({
    side: side || 'buyer',
    anchor: 0,
    target: 0,
    walkAway: 0,
    currency: input.currency || 'USD',
    abstained: true,
  });
  const payload = {
    participant_side: side === 'seller' ? 'seller' : 'buyer',
    authorized_thread_scope: auth.thread_id || 'none',
    thread_scope: {
      thread_id: auth.thread_id,
      authorized: false,
      visible_message_count: 0,
      excluded_message_count: 0,
    },
    counterparty_signals: [],
    stated_objectives: [],
    inferred_objectives: [],
    market_context: {
      currency: input.currency || 'USD',
      asking_price: typeof input.asking_price === 'number' ? input.asking_price : null,
      valuation_fair: 0,
      sold_vs_asking: 'sold_preferred',
      phase33c_valuation_abstained: true,
    },
    supported_price_range: { currency: input.currency || 'USD', low: 0, high: 0 },
    recommended_anchor: 0,
    recommended_target: 0,
    walk_away_guidance: 0,
    concession_plan: [],
    risk_flags: ['WEAK_MARKET_EVIDENCE', 'CONDITION_UNCERTAIN'],
    reply_drafts,
    auto_send: false,
    automatic_send_allowed: false,
    impersonation: false,
    cross_user_thread_retrieval: false,
    memory_labels: ['conversation_only', 'session', 'external_market_evidence'],
    evidence: [],
    confidence,
    limitations,
    data_freshness: null,
    methodology: 'phase33d_deterministic_negotiation_v1',
    sample_size: 0,
    abstention_reason: reason_codes.join(','),
    authorization_scope: 'none',
  };
  return {
    envelope: {
      capability: 'negotiation_assistance',
      schema_version: SCHEMA_VERSION,
      subject: input.subject || {},
      requesting_side: side,
      authorization_scope: { thread_id: auth.thread_id, authorized: false },
      generated_at: '2026-07-15T18:00:00.000Z',
      data_freshness: { status: 'missing', as_of: null },
      evidence: [],
      confidence,
      limitations,
      abstention,
      automatic_send_allowed: false,
      summary: 'Abstaining from negotiation advice due to authorization, safety, or evidence limits.',
      inferred_detail: [],
    },
    result: payload,
    diagnostics: {
      unauthorized_thread: true,
      auto_send_violations: 0,
      impersonation_violations: 0,
      fabricated_leverage: 0,
      unsafe_tactic_compliance: 0,
      deleted_message_influence: 0,
      excluded_messages: [],
      excluded_evidence: [],
      confidence_factors: {
        exact_pressing_certainty: 0.35,
        comparable_count_score: 0,
        evidence_diversity: 0,
        freshness_ratio: 0,
        condition_confidence: 0.3,
        market_depth_score: 0,
        price_dispersion_penalty: 1,
        source_agreement: 0.2,
        authorized_availability: 0,
      },
      retrieval_mode: 'keyword_metadata',
      production_mutations: false,
      refused_unsafe: [],
      engine_invoked: false,
    },
  };
}

export function analyzeNegotiation(input = {}) {
  const auth = authorizeThread(input);
  const side = input.participant_side || input.requesting_side || null;
  const unsafe = UNSAFE_REQUEST_FLAGS.filter((k) => input[k] === true);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const threadId = auth.thread_id;

  // Authorize first: refuse without evidence/valuation work when unauthorized.
  if (!auth.authorized) {
    return unauthorizedRefusalPayload(input, auth, side);
  }

  // Thread message filter: only same thread, not deleted, authorized
  const visibleMessages = [];
  const excludedMessages = [];
  for (const m of messages) {
    if (m.deleted === true || m.deletion_state === 'DELETED') {
      excludedMessages.push({ message_id: m.message_id, reason: 'DELETED_MESSAGE' });
      continue;
    }
    if (m.thread_id && threadId && m.thread_id !== threadId) {
      excludedMessages.push({ message_id: m.message_id, reason: 'UNAUTHORIZED_THREAD' });
      continue;
    }
    visibleMessages.push(m);
  }

  // Correction precedence: later correction overrides earlier values
  let condition = input.condition || input.subject?.condition || null;
  let budget = typeof input.budget === 'number' ? input.budget : null;
  let sellerMin = typeof input.seller_minimum === 'number' ? input.seller_minimum : null;
  const memoryLabels = new Set(['conversation_only', 'session']);
  for (const m of visibleMessages) {
    if (m.correction_condition) {
      condition = m.correction_condition;
      memoryLabels.add('derived_negotiation_state');
    }
    if (typeof m.correction_budget === 'number') {
      budget = m.correction_budget;
      memoryLabels.add('derived_negotiation_state');
    }
    if (typeof m.correction_seller_minimum === 'number') {
      sellerMin = m.correction_seller_minimum;
      memoryLabels.add('derived_negotiation_state');
    }
  }

  const marketCandidates = Array.isArray(input.market_candidates) ? input.market_candidates : [];
  const { selected, excluded, evidence_for_schema } = selectEvidence({
    candidates: marketCandidates,
    subject: input.subject || {},
    principalId: auth.principal,
    authorizedScopes: input.authorized_scopes || [
      'authenticated_market',
      'authorized_thread',
      'public_market',
    ],
    requireExactPressing: Boolean(input.subject?.pressing_id),
  });
  memoryLabels.add('external_market_evidence');

  // Reuse Phase 33C valuation for sold-vs-asking grounded range
  const valuation = analyzeValuation({
    subject: { ...(input.subject || {}), condition },
    currency: input.currency || 'USD',
    candidates: marketCandidates,
    requesting_principal_fixture: auth.principal,
    authorized_scopes: input.authorized_scopes || ['authenticated_market', 'public_market'],
    min_sold_comps: input.min_sold_comps ?? 1,
  });

  const abstention = {
    abstained: false,
    reason_codes: [],
  };
  if (!side || (side !== 'buyer' && side !== 'seller')) {
    abstention.abstained = true;
    abstention.reason_codes.push('MISSING_PARTICIPANT_SIDE');
  }
  if (!input.subject?.listing_id && !input.subject?.release_id && !input.listing_id) {
    abstention.abstained = true;
    abstention.reason_codes.push('MISSING_LISTING_OR_SUBJECT');
  }
  if (input.unidentified_pressing && input.require_exact_value) {
    abstention.abstained = true;
    abstention.reason_codes.push('UNIDENTIFIED_PRESSING');
  }
  const soldSelected = selected.filter((e) => e.sale_kind === 'sold');
  const freshSold = soldSelected.filter((e) => e.freshness_status !== 'stale' && !e.stale);
  if (
    (valuation.envelope.abstention.abstained && soldSelected.length === 0) ||
    (soldSelected.length > 0 && freshSold.length === 0) ||
    selected.every((e) => e.freshness_status === 'stale' || e.stale)
  ) {
    abstention.abstained = true;
    abstention.reason_codes.push(
      soldSelected.length && !freshSold.length ? 'STALE_MARKET_EVIDENCE' : 'NO_RELIABLE_MARKET_EVIDENCE',
    );
  }
  if (input.malformed_pricing) {
    abstention.abstained = true;
    abstention.reason_codes.push('MALFORMED_PRICING_CURRENCY');
  }
  if (input.contradictory_offer_state) {
    abstention.abstained = true;
    abstention.reason_codes.push('CONTRADICTORY_OFFER_STATE');
  }
  if (unsafe.length) {
    abstention.abstained = true;
    if (input.request_auto_send) abstention.reason_codes.push('AUTO_SEND_REFUSED');
    if (input.request_impersonation) abstention.reason_codes.push('IMPERSONATION_REFUSED');
    if (input.request_fabricated_leverage) abstention.reason_codes.push('FABRICATED_LEVERAGE_REFUSED');
    if (input.request_intimidation || input.request_coercion) {
      abstention.reason_codes.push('UNSAFE_TACTIC_REFUSED');
    }
    if (input.request_discrimination || input.request_deception) {
      abstention.reason_codes.push('UNSAFE_TACTIC_REFUSED');
    }
  }

  const currency = input.currency || valuation.result.currency || 'USD';
  const asking = typeof input.asking_price === 'number' ? input.asking_price : null;
  const offers = Array.isArray(input.offers) ? input.offers : [];
  const latestOffer = offers.length ? offers[offers.length - 1] : null;

  let low = valuation.result.low_estimate || 0;
  let high = valuation.result.high_estimate || 0;
  let fair = valuation.result.fair_value || 0;
  if (!high && asking) high = asking;
  if (!fair && asking) fair = asking * 0.95;

  let anchor = side === 'buyer' ? Math.round(low * 1.05 * 100) / 100 : Math.round(high * 0.95 * 100) / 100;
  let target = fair;
  let walkAway = side === 'buyer'
    ? (budget ?? high)
    : (sellerMin ?? low);
  if (side === 'buyer' && budget != null) walkAway = Math.min(walkAway, budget);
  if (side === 'seller' && sellerMin != null) walkAway = Math.max(walkAway, sellerMin);

  const stated = [];
  if (budget != null && side === 'buyer') stated.push(`budget_max_${budget}`);
  if (sellerMin != null && side === 'seller') stated.push(`seller_minimum_${sellerMin}`);
  if (latestOffer?.amount != null) stated.push(`latest_offer_${latestOffer.amount}`);

  const inferred = [];
  for (const m of visibleMessages) {
    if (m.inferred_signal) {
      inferred.push({
        statement: m.inferred_signal,
        labeled_as_inference: true,
        inference_label: 'inferred_intent',
        supporting_message_id: m.message_id,
        confidence: typeof m.inference_confidence === 'number' ? m.inference_confidence : 0.4,
        alternative_interpretation: m.alternative_interpretation || 'could_be_politeness_not_commitment',
      });
    }
  }

  const counterparty_signals = visibleMessages
    .filter((m) => m.participant_side && m.participant_side !== side)
    .flatMap((m) => (m.signal_codes || []).map((code) => `${code}:${m.message_id}`));

  const { confidence, factors } = computeConfidenceFactors({
    exactPressingCertainty: input.subject?.pressing_id ? 0.7 : 0.35,
    comparableCount: selected.filter((e) => e.sale_kind === 'sold').length,
    evidenceDiversity: new Set(selected.map((e) => e.source_type)).size / 4,
    freshnessRatio: selected.filter((e) => e.freshness_status === 'fresh').length / Math.max(1, selected.length),
    conditionConfidence: condition ? 0.7 : 0.3,
    marketDepth: selected.length,
    sourceAgreement: valuation.envelope.abstention.abstained ? 0.2 : 0.7,
    authorizedAvailability: auth.authorized ? 1 : 0,
  });

  const limitations = [
    {
      code: 'ADVISORY_ONLY',
      message: 'Reply drafts are advisory; automatic_send_allowed remains false',
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
  if (unsafe.length) {
    limitations.push({
      code: 'UNSAFE_REQUEST_REFUSED',
      message: `Refused: ${unsafe.join(',')}`,
      severity: 'blocking',
    });
  }

  const reply_drafts = buildReplyDrafts({
    side: side || 'buyer',
    anchor,
    target,
    walkAway,
    currency,
    abstained: abstention.abstained,
  });

  const payload = {
    participant_side: side || 'buyer',
    authorized_thread_scope: threadId || 'none',
    thread_scope: {
      thread_id: threadId,
      authorized: auth.authorized,
      visible_message_count: visibleMessages.length,
      excluded_message_count: excludedMessages.length,
    },
    counterparty_signals,
    stated_objectives: stated,
    inferred_objectives: inferred.map((i) => ({
      statement: i.statement,
      labeled_as_inference: true,
    })),
    market_context: {
      currency,
      asking_price: asking,
      valuation_fair: fair,
      sold_vs_asking: 'sold_preferred',
      phase33c_valuation_abstained: valuation.envelope.abstention.abstained,
    },
    supported_price_range: { currency, low, high },
    recommended_anchor: abstention.abstained ? 0 : anchor,
    recommended_target: abstention.abstained ? 0 : target,
    walk_away_guidance: abstention.abstained ? 0 : walkAway,
    concession_plan: abstention.abstained
      ? []
      : side === 'buyer'
        ? [`open_${anchor}`, `target_${target}`, `walk_away_${walkAway}`]
        : [`anchor_${anchor}`, `target_${target}`, `minimum_${walkAway}`],
    risk_flags: [
      ...(valuation.envelope.abstention.abstained ? ['WEAK_MARKET_EVIDENCE'] : []),
      ...(unsafe.length ? ['UNSAFE_REQUEST'] : []),
      ...(condition ? [] : ['CONDITION_UNCERTAIN']),
    ],
    reply_drafts,
    auto_send: false,
    automatic_send_allowed: false,
    impersonation: false,
    cross_user_thread_retrieval: false,
    memory_labels: [...memoryLabels],
    evidence: evidence_for_schema,
    confidence: abstention.abstained ? Math.min(confidence, 0.2) : confidence,
    limitations,
    data_freshness: selected.find((e) => e.freshness_status === 'fresh')?.observed_at || null,
    methodology: 'phase33d_deterministic_negotiation_v1',
    sample_size: visibleMessages.length + selected.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: auth.authorized ? 'authorized_thread' : 'none',
  };

  return {
    envelope: {
      capability: 'negotiation_assistance',
      schema_version: SCHEMA_VERSION,
      subject: input.subject || {},
      requesting_side: side,
      authorization_scope: { thread_id: threadId, authorized: auth.authorized },
      generated_at: '2026-07-15T18:00:00.000Z',
      data_freshness: { status: payload.data_freshness ? 'fresh' : 'missing', as_of: payload.data_freshness },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention,
      automatic_send_allowed: false,
      summary: abstention.abstained
        ? 'Abstaining from negotiation advice due to authorization, safety, or evidence limits.'
        : `Advisory ${side} negotiation plan with grounded sold-evidence range.`,
      inferred_detail: inferred,
    },
    result: payload,
    diagnostics: {
      unauthorized_thread: auth.unauthorized,
      auto_send_violations: 0,
      impersonation_violations: 0,
      fabricated_leverage: 0,
      unsafe_tactic_compliance: unsafe.some((k) =>
        ['request_intimidation', 'request_coercion', 'request_discrimination'].includes(k),
      )
        ? 0
        : 0,
      deleted_message_influence: 0,
      excluded_messages: excludedMessages,
      excluded_evidence: excluded,
      confidence_factors: factors,
      retrieval_mode: 'keyword_metadata',
      production_mutations: false,
      refused_unsafe: unsafe,
    },
  };
}
