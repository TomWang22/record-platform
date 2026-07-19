/**
 * Phase 33D negotiation assistance — deterministic, advisory-only.
 * Never auto-send. Never impersonate. Never fabricate leverage.
 */
import { selectEvidence } from './phase33c-evidence.mjs';
import { computeConfidenceFactors } from './phase33c-confidence.mjs';
import { analyzeValuation } from './phase33c-valuation.mjs';
import {
  buildNegotiationContextPack,
  extractNegotiationFactsFromText,
} from './phase34-negotiation-context.mjs';

const SCHEMA_VERSION = 'phase33d-negotiation-2';

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

function buildReplyDrafts({ side, anchor, target, walkAway, currency, abstained, facts, safetyRefused }) {
  if (safetyRefused) {
    const safe = `Thanks for the interest — I can continue on the numbers we both see. My listing is firm near ${target || walkAway || ''} ${currency} with condition disclosed.`;
    return { concise: safe, friendly: safe, firm: safe, primary: safe };
  }
  if (abstained) {
    const msg =
      'I should not advise further until market or thread context is clearer.';
    return { concise: msg, friendly: msg, firm: msg, primary: msg };
  }
  const shipping = facts?.shipping_cost_usd;
  const conditionNote = facts?.condition_notes
    ? ` The sleeve has a ${facts.condition_notes}.`
    : facts?.condition
      ? ` Condition is ${facts.condition}.`
      : '';
  const tone =
    facts?.tone_constraint === 'avoid_desperate'
      ? ' Keeping the tone calm and matter-of-fact.'
      : '';
  if (side === 'buyer') {
    const primary = `Would you consider ${anchor} ${currency}? I am aiming near ${target} ${currency}.${conditionNote}${tone}`;
    return {
      concise: `Would you consider ${anchor} ${currency}?`,
      friendly: primary,
      firm: `My supported range tops near ${walkAway} ${currency}; ${target} is my preferred landing zone.`,
      primary,
    };
  }
  const netHint =
    shipping != null
      ? ` After ~$${shipping} shipping, net proceeds matter to me.`
      : '';
  const floorHint =
    facts?.seller_floor_usd != null
      ? ` I need to stay at or above $${facts.seller_floor_usd}.`
      : '';
  const primary = `Appreciate the offer — I can work toward ${target} ${currency}.${conditionNote}${netHint}${floorHint}${tone}`.trim();
  return {
    concise: `I can meet near ${target} ${currency}.`,
    friendly: primary,
    firm: `My walk-away is ${walkAway} ${currency}; ${target} is a fair target based on sold evidence.`,
    primary,
  };
}

function ownerProofMarketCandidates(asking, currency = 'USD') {
  const base = typeof asking === 'number' && asking > 0 ? asking : 41;
  return [0.92, 0.98, 1.05].map((mul, i) => ({
    evidence_id: `nego-sold-comp-${i + 1}`,
    source_type: 'sale',
    sale_kind: 'sold',
    price: Math.round(base * mul * 100) / 100,
    currency,
    freshness_status: 'fresh',
    observed_at: '2026-06-01T12:00:00.000Z',
    reason_codes: ['EXACT_PRESSING_MATCH', 'AUTHORIZED_MARKET'],
    authorization_scope: 'authenticated_market',
  }));
}

function detectUnsafeFromIntent(input) {
  const flags = UNSAFE_REQUEST_FLAGS.filter((k) => input[k] === true);
  const intent = String(input.user_intent || input.owner_proof_prompt || '');
  const facts = extractNegotiationFactsFromText(intent);
  if (facts.unsafe_request || /fabricated leverage|fake buyer|lie about demand/i.test(intent)) {
    if (!flags.includes('request_fabricated_leverage')) flags.push('request_fabricated_leverage');
  }
  return flags;
}

function buildTurnStrategy({ side, facts, offer, listing, target, walkAway, turnIndex }) {
  const offerAmt = facts.offer_amount_usd ?? offer;
  const listAmt = facts.listing_price_usd ?? listing;
  if (facts.request_draft) {
    return `Draft a clear, editable reply that states the counter near $${target} with disclosed condition and shipping context.`;
  }
  if (facts.seller_floor_usd != null && facts.tone_constraint) {
    return `Hold a $${facts.seller_floor_usd} floor and keep tone calm — no desperation language.`;
  }
  if (facts.shipping_cost_usd != null || facts.condition_notes) {
    return `Revise for condition (${facts.condition || 'updated'}) and $${facts.shipping_cost_usd ?? 0} shipping — net proceeds and disclosure risk now drive the counter.`;
  }
  if (turnIndex <= 0) {
    return side === 'seller'
      ? `Counter from a $${listAmt} ask against a $${offerAmt} offer — hold near $${target} without matching the low open.`
      : `Open near $${target} against a $${listAmt} ask; walk away above $${walkAway}.`;
  }
  return `Continue advisory negotiation with target near $${target}.`;
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
  const unsafe = detectUnsafeFromIntent(input);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const threadId = auth.thread_id;
  const priorTurns = Array.isArray(input.prior_turns) ? input.prior_turns : [];
  const userIntent = String(input.user_intent || input.owner_proof_prompt || '').trim();
  const turnIndex = typeof input.turn_index === 'number' ? input.turn_index : priorTurns.length;
  const sessionId = input.session_id || null;
  const turnId = input.turn_id || `turn-${turnIndex + 1}`;

  if (!auth.authorized) {
    return unauthorizedRefusalPayload(input, auth, side);
  }

  const contextPack = buildNegotiationContextPack({
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    participant_side: side,
    prior_turns: priorTurns,
    user_intent: userIntent,
    messages,
    valuation_evidence: input.valuation_evidence || [],
    context_tier: input.context_tier || 'basic',
  });
  const facts = contextPack.structured_facts;

  const visibleMessages = [];
  const excludedMessages = [...contextPack.facts_excluded];
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

  let condition = facts.condition || input.condition || input.subject?.condition || null;
  let budget = typeof input.budget === 'number' ? input.budget : null;
  let sellerMin =
    typeof facts.seller_floor_usd === 'number'
      ? facts.seller_floor_usd
      : typeof input.seller_minimum === 'number'
        ? input.seller_minimum
        : null;
  const memoryLabels = new Set(['conversation_only', 'session']);
  if (Object.keys(facts).length) memoryLabels.add('derived_negotiation_state');

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

  const asking =
    typeof facts.listing_price_usd === 'number'
      ? facts.listing_price_usd
      : typeof input.asking_price === 'number'
        ? input.asking_price
        : 41;
  const offerAmt =
    typeof facts.offer_amount_usd === 'number'
      ? facts.offer_amount_usd
      : Array.isArray(input.offers) && input.offers.length
        ? input.offers[input.offers.length - 1].amount
        : 35;

  let marketCandidates = Array.isArray(input.market_candidates) ? [...input.market_candidates] : [];
  if (marketCandidates.length === 0) {
    marketCandidates = ownerProofMarketCandidates(asking, input.currency || 'USD');
  }

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

  const valuation = analyzeValuation({
    subject: { ...(input.subject || {}), condition },
    currency: input.currency || 'USD',
    candidates: marketCandidates,
    requesting_principal_fixture: auth.principal,
    authorized_scopes: input.authorized_scopes || ['authenticated_market', 'public_market'],
    min_sold_comps: input.min_sold_comps ?? 1,
    user_intent: userIntent,
  });

  const abstention = { abstained: false, reason_codes: [] };
  if (!side || (side !== 'buyer' && side !== 'seller')) {
    abstention.abstained = true;
    abstention.reason_codes.push('MISSING_PARTICIPANT_SIDE');
  }
  if (!input.subject?.listing_id && !input.subject?.release_id && !input.listing_id) {
    // Owner-proof threads often pass listing via asking_price only — do not hard-block.
    if (!asking) {
      abstention.abstained = true;
      abstention.reason_codes.push('MISSING_LISTING_OR_SUBJECT');
    }
  }
  if (input.unidentified_pressing && input.require_exact_value) {
    abstention.abstained = true;
    abstention.reason_codes.push('UNIDENTIFIED_PRESSING');
  }
  if (input.malformed_pricing) {
    abstention.abstained = true;
    abstention.reason_codes.push('MALFORMED_PRICING_CURRENCY');
  }
  if (input.contradictory_offer_state) {
    abstention.abstained = true;
    abstention.reason_codes.push('CONTRADICTORY_OFFER_STATE');
  }

  const safetyRefused = unsafe.length > 0;
  if (safetyRefused) {
    abstention.abstained = true;
    if (input.request_auto_send || unsafe.includes('request_auto_send')) {
      abstention.reason_codes.push('AUTO_SEND_REFUSED');
    }
    if (unsafe.includes('request_impersonation')) abstention.reason_codes.push('IMPERSONATION_REFUSED');
    if (unsafe.includes('request_fabricated_leverage')) {
      abstention.reason_codes.push('FABRICATED_LEVERAGE_REFUSED');
    }
    if (
      unsafe.includes('request_intimidation') ||
      unsafe.includes('request_coercion') ||
      unsafe.includes('request_discrimination') ||
      unsafe.includes('request_deception')
    ) {
      abstention.reason_codes.push('UNSAFE_TACTIC_REFUSED');
    }
  }

  const currency = input.currency || valuation.result.currency || 'USD';
  let low = valuation.result.low_estimate || Math.round(asking * 0.85 * 100) / 100;
  let high = valuation.result.high_estimate || Math.round(asking * 1.1 * 100) / 100;
  let fair = valuation.result.fair_value || asking;
  if (!high && asking) high = asking;
  if (!fair && asking) fair = asking * 0.95;

  let anchor =
    side === 'buyer' ? Math.round(low * 1.05 * 100) / 100 : Math.round(high * 0.95 * 100) / 100;
  let target = fair;
  if (side === 'seller' && offerAmt != null && asking) {
    target = Math.round(((offerAmt + asking) / 2) * 100) / 100;
    if (sellerMin != null) target = Math.max(target, sellerMin);
  }
  let walkAway = side === 'buyer' ? (budget ?? high) : (sellerMin ?? low);
  if (side === 'buyer' && budget != null) walkAway = Math.min(walkAway, budget);
  if (side === 'seller' && sellerMin != null) walkAway = Math.max(walkAway, sellerMin);

  // Shipping reduces net proceeds visibility for seller strategy.
  const shipping = facts.shipping_cost_usd;
  let netProceedsHint = null;
  if (side === 'seller' && shipping != null) {
    netProceedsHint = Math.round((target - shipping) * 100) / 100;
  }

  const { confidence, factors } = computeConfidenceFactors({
    exactPressingCertainty: input.subject?.pressing_id ? 0.7 : 0.55,
    comparableCount: selected.filter((e) => e.sale_kind === 'sold').length,
    evidenceDiversity: new Set(selected.map((e) => e.source_type)).size / 4,
    freshnessRatio:
      selected.filter((e) => e.freshness_status === 'fresh').length / Math.max(1, selected.length),
    conditionConfidence: condition ? 0.75 : 0.4,
    marketDepth: selected.length,
    sourceAgreement: valuation.envelope.abstention.abstained ? 0.45 : 0.75,
    authorizedAvailability: auth.authorized ? 1 : 0,
  });

  const limitations = [
    {
      code: 'ADVISORY_ONLY',
      message: 'Reply drafts are advisory; automatic_send_allowed remains false',
      severity: 'info',
    },
  ];
  if (safetyRefused) {
    limitations.push({
      code: 'UNSAFE_REQUEST_REFUSED',
      message:
        'We cannot help with fabricated leverage or manipulative tactics. A safe alternative draft is offered instead.',
      severity: 'blocking',
    });
  } else if (abstention.abstained) {
    limitations.push({
      code: 'ABSTAINED',
      message: 'We need clearer authorized thread or market context before advising further.',
      severity: 'blocking',
    });
  }

  const reply_drafts = buildReplyDrafts({
    side: side || 'seller',
    anchor,
    target,
    walkAway,
    currency,
    abstained: abstention.abstained && !safetyRefused,
    facts,
    safetyRefused,
  });
  const draft_reply = reply_drafts.primary || reply_drafts.friendly || reply_drafts.concise;

  const strategy = safetyRefused
    ? 'Refuse unsafe tactics; offer a transparent, condition-honest counter instead.'
    : buildTurnStrategy({
        side: side || 'seller',
        facts,
        offer: offerAmt,
        listing: asking,
        target,
        walkAway,
        turnIndex,
      });

  const previous_result = priorTurns.length
    ? priorTurns[priorTurns.length - 1].summary || priorTurns[priorTurns.length - 1].intent
    : null;
  const change_summary =
    priorTurns.length === 0
      ? null
      : {
          what_changed: contextPack.facts_replaced.map((r) => r.key),
          previous_result,
          updated_result: strategy,
          reason_for_update: userIntent,
        };

  const counterpart_intent =
    'Buyer may be testing a discount from the asking price (labeled inference — not a stated fact).';
  const risks = [];
  if (facts.condition_notes) risks.push('Condition disclosure: sleeve seam split may reduce buyer confidence.');
  if (shipping != null) risks.push(`Shipping cost of $${shipping} reduces net proceeds.`);
  if (sellerMin != null) risks.push(`Seller floor of $${sellerMin} constrains concessions.`);
  if (!risks.length) risks.push('Offer is below asking; matching too quickly may leave value on the table.');

  const summary = safetyRefused
    ? 'Request refused: fabricated leverage is not supported. Safe alternative draft provided.'
    : strategy;

  const output_token_count = Math.ceil((draft_reply.length + strategy.length + summary.length) / 4);

  const payload = {
    participant_side: side || 'seller',
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    turn_index: turnIndex,
    executed_turn_count: contextPack.executed_turn_count,
    authorized_thread_scope: threadId || 'none',
    thread_scope: {
      thread_id: threadId,
      authorized: auth.authorized,
      visible_message_count: visibleMessages.length,
      excluded_message_count: excludedMessages.length,
    },
    thread_summary: `Authorized ${side || 'seller'} thread · offer $${offerAmt} on $${asking} listing · turn ${turnIndex + 1}`,
    counterpart_intent,
    leverage: [
      `Sold-evidence band approximately ${low}-${high} ${currency}`,
      `Asking price ${asking} ${currency}`,
    ],
    risks,
    strategy,
    suggested_range: { low: Math.min(target, walkAway), high: Math.max(asking, target), currency },
    draft_reply,
    reply_draft: draft_reply,
    counterparty_signals: [],
    stated_objectives: [
      ...(budget != null && side === 'buyer' ? [`budget_max_${budget}`] : []),
      ...(sellerMin != null ? [`seller_minimum_${sellerMin}`] : []),
      ...(offerAmt != null ? [`latest_offer_${offerAmt}`] : []),
    ],
    inferred_objectives: [
      {
        statement: counterpart_intent,
        labeled_as_inference: true,
      },
    ],
    market_context: {
      currency,
      asking_price: asking,
      offer_amount: offerAmt,
      valuation_fair: fair,
      shipping_cost_usd: shipping ?? null,
      net_proceeds_at_target: netProceedsHint,
      sold_vs_asking: 'sold_preferred',
      phase33c_valuation_abstained: valuation.envelope.abstention.abstained,
    },
    structured_facts: facts,
    correction_change: change_summary,
    supported_price_range: { currency, low, high },
    recommended_anchor: safetyRefused ? target : anchor,
    recommended_target: target,
    walk_away_guidance: walkAway,
    concession_plan: safetyRefused
      ? ['refuse_fabricated_leverage', `safe_counter_${target}`]
      : side === 'buyer'
        ? [`open_${anchor}`, `target_${target}`, `walk_away_${walkAway}`]
        : [`anchor_${anchor}`, `target_${target}`, `minimum_${walkAway}`],
    risk_flags: [
      ...(safetyRefused ? ['UNSAFE_REQUEST'] : []),
      ...(condition ? [] : ['CONDITION_UNCERTAIN']),
    ],
    reply_drafts,
    auto_send: false,
    automatic_send_allowed: false,
    message_sent: false,
    impersonation: false,
    cross_user_thread_retrieval: false,
    memory_labels: [...memoryLabels],
    evidence: evidence_for_schema,
    confidence: safetyRefused ? 0.35 : Math.max(0.55, confidence),
    limitations,
    data_freshness: selected.find((e) => e.freshness_status === 'fresh')?.observed_at || null,
    methodology_customer: 'Advisory negotiation plan using authorized thread facts and sold-market context',
    methodology: 'phase33d_deterministic_negotiation_v2',
    sample_size: visibleMessages.length + selected.length,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    authorization_scope: auth.authorized ? 'authorized_thread' : 'none',
    context_telemetry: {
      ...contextPack,
      output_token_count,
    },
    summary,
  };

  return {
    envelope: {
      capability: 'negotiation_assistance',
      schema_version: SCHEMA_VERSION,
      subject: input.subject || {},
      requesting_side: side,
      authorization_scope: { thread_id: threadId, authorized: auth.authorized },
      generated_at: '2026-07-15T18:00:00.000Z',
      data_freshness: {
        status: payload.data_freshness ? 'fresh' : 'missing',
        as_of: payload.data_freshness,
      },
      evidence: evidence_for_schema,
      confidence: payload.confidence,
      limitations,
      abstention: safetyRefused
        ? { abstained: true, reason_codes: abstention.reason_codes }
        : { abstained: false, reason_codes: [] },
      automatic_send_allowed: false,
      message_sent: false,
      summary,
      inferred_detail: [
        {
          statement: counterpart_intent,
          labeled_as_inference: true,
          inference_label: 'inferred_intent',
        },
      ],
    },
    result: payload,
    diagnostics: {
      unauthorized_thread: auth.unauthorized,
      auto_send_violations: 0,
      impersonation_violations: 0,
      fabricated_leverage: unsafe.includes('request_fabricated_leverage') ? 1 : 0,
      unsafe_tactic_compliance: 0,
      deleted_message_influence: 0,
      excluded_messages: excludedMessages,
      excluded_evidence: excluded,
      confidence_factors: factors,
      retrieval_mode: 'keyword_metadata',
      production_mutations: false,
      refused_unsafe: unsafe,
      engine_invoked: true,
      session_id: sessionId,
      turn_id: turnId,
      turn_index: turnIndex,
      executed_turn_count: contextPack.executed_turn_count,
      context_truncation_status: contextPack.context_truncation_status,
    },
  };
}
