/**
 * Phase E1 — structured query plan from user request.
 * Produces capability/goal/subject/constraints/evidence/retrieval/calc/tool intents.
 * Compound + follow-up refinement uses session facts when provided.
 */
import { EIGHT_CAPABILITIES } from './phase34-capability-response.mjs';

export const QUERY_PLAN_VERSION = 'phase34-query-plan-v1';

export const RESPONSE_DEPTHS = Object.freeze([
  'COMPACT',
  'STANDARD',
  'DEEP',
  'CONVERSATIONAL',
]);

export const RETRIEVAL_MODES = Object.freeze([
  'exact',
  'keyword',
  'vector',
  'hybrid',
]);

export const EVIDENCE_TYPES = Object.freeze([
  'catalog',
  'listings',
  'settlements',
  'auctions',
  'bids',
  'offers',
  'watchlists',
  'collection',
  'preferences',
  'messages',
  'memory',
]);

const CAPABILITY_HINTS = Object.freeze({
  scarcity: /\bscarci|supply|how\s+rare|availability\b/i,
  valuation: /\bvalu|worth|price\s+guide|fair\s+value|comps?\b/i,
  auction_intelligence: /\bauction|bid\s+war|ending\s+soon|watchlist\s+auction\b/i,
  embeddings: /\bembed|re-?embed|vectoriz/i,
  semantic_search: /\bsearch|find\s+(albums?|pressings?|releases?)|look\s+up\b/i,
  negotiation_assistance: /\bnegotiat|offer|counter|draft\s+(a\s+)?(reply|message)|shipping\b/i,
  recommendations: /\brecommend|suggest|similar\s+to|for\s+you\b/i,
  market_analytics: /\banalytics?|trend|%?\s*change|median|liquidity|temperature\b/i,
});

const DEPTH_HINTS = Object.freeze({
  COMPACT: /\bbrief|tl;?dr|one\s+line|short\b/i,
  DEEP: /\bdeep|detailed|full\s+report|exhaustive|with\s+evidence\b/i,
  CONVERSATIONAL: /\bexplain\s+like|talk\s+me\s+through|conversational\b/i,
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function activeFactMap(sessionFacts = []) {
  const map = new Map();
  for (const fact of asArray(sessionFacts)) {
    if (!fact || fact.active === false) continue;
    if (fact.key) map.set(fact.key, fact.value);
  }
  return map;
}

function detectCapability(text, explicit) {
  if (explicit && EIGHT_CAPABILITIES.includes(explicit)) return explicit;
  for (const [cap, re] of Object.entries(CAPABILITY_HINTS)) {
    if (re.test(text)) return cap;
  }
  return 'semantic_search';
}

function detectDepth(text, explicit) {
  if (explicit && RESPONSE_DEPTHS.includes(explicit)) return explicit;
  for (const [depth, re] of Object.entries(DEPTH_HINTS)) {
    if (re.test(text)) return depth;
  }
  return 'STANDARD';
}

function detectTimeRange(text, facts) {
  const iso = text.match(
    /(?:from|since)\s+(\d{4}-\d{2}-\d{2}).*?(?:to|until|through)\s+(\d{4}-\d{2}-\d{2})/i,
  );
  if (iso) {
    return {
      start: `${iso[1]}T00:00:00.000Z`,
      end: `${iso[2]}T23:59:59.999Z`,
      timezone: 'UTC',
      source: 'request_text',
    };
  }
  if (/\blast\s+90\s+days\b/i.test(text)) {
    return { relative: 'last_90_days', timezone: 'UTC', source: 'request_text' };
  }
  if (facts.has('time_range')) {
    return { ...facts.get('time_range'), source: 'session_fact' };
  }
  return null;
}

function detectSubject(text, facts, explicitSubject) {
  const subject = { ...(explicitSubject || {}) };
  if (facts.has('release_id') && !subject.release_id) {
    subject.release_id = facts.get('release_id');
  }
  if (facts.has('pressing_id') && !subject.pressing_id) {
    subject.pressing_id = facts.get('pressing_id');
  }
  if (facts.has('listing_id') && !subject.listing_id) {
    subject.listing_id = facts.get('listing_id');
  }
  const listing = text.match(/\blisting[_ ]?([a-z0-9-]+)\b/i);
  if (listing && !subject.listing_id) subject.listing_id = listing[1];
  const artist = text.match(/\b(?:by|artist)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+){0,3})/);
  if (artist && !subject.artist) subject.artist = artist[1].trim();
  const title = text.match(/\b(?:album|release|title)\s+["“](.+?)["”]/i);
  if (title && !subject.title) subject.title = title[1].trim();
  if (facts.has('subject_artist') && !subject.artist) {
    subject.artist = facts.get('subject_artist');
  }
  if (facts.has('subject_title') && !subject.title) {
    subject.title = facts.get('subject_title');
  }
  return subject;
}

function detectConstraints(text, facts) {
  const constraints = {};
  if (/\bexact\s+pressing\b|\bthis\s+pressing\s+only\b/i.test(text) || facts.get('exact_pressing') === true) {
    constraints.exact_pressing = true;
  }
  if (/\bpicture\s+disc\b/i.test(text) && /\bexclud|without|no\b/i.test(text)) {
    constraints.exclude_picture_disc = true;
  }
  const currency = text.match(/\b(USD|EUR|GBP)\b/);
  if (currency) constraints.currency = currency[1];
  else if (facts.has('currency')) constraints.currency = facts.get('currency');
  const country = text.match(/\bcountry\s*=\s*([A-Z]{2})\b/i) || text.match(/\bin\s+the\s+(US|UK)\b/i);
  if (country) constraints.country = country[1].toUpperCase() === 'UK' ? 'GB' : country[1].toUpperCase();
  const condition = text.match(/\b(NM|M|VG\+|VG|G\+|G)\b/);
  if (condition) constraints.min_condition = condition[1];
  else if (facts.has('min_condition')) constraints.min_condition = facts.get('min_condition');
  if (facts.has('shipping_amount_usd')) {
    constraints.shipping_amount_usd = facts.get('shipping_amount_usd');
  }
  if (facts.has('offer_amount_usd')) {
    constraints.offer_amount_usd = facts.get('offer_amount_usd');
  }
  return constraints;
}

function evidenceTypesFor(capability, constraints) {
  const base = new Set(['catalog', 'memory']);
  switch (capability) {
    case 'scarcity':
      base.add('listings');
      base.add('settlements');
      break;
    case 'valuation':
      base.add('settlements');
      base.add('listings');
      break;
    case 'auction_intelligence':
      base.add('auctions');
      base.add('bids');
      base.add('watchlists');
      break;
    case 'embeddings':
      base.add('catalog');
      base.add('listings');
      break;
    case 'semantic_search':
      base.add('catalog');
      base.add('listings');
      break;
    case 'negotiation_assistance':
      base.add('offers');
      base.add('messages');
      base.add('listings');
      base.add('settlements');
      break;
    case 'recommendations':
      base.add('collection');
      base.add('preferences');
      base.add('catalog');
      break;
    case 'market_analytics':
      base.add('settlements');
      base.add('listings');
      base.add('auctions');
      break;
    default:
      break;
  }
  if (constraints.exact_pressing) base.add('catalog');
  return [...base].filter((t) => EVIDENCE_TYPES.includes(t));
}

function retrievalModesFor(capability, text) {
  const modes = ['exact', 'keyword'];
  if (/\bhybrid\b|\bsemantic\b|\bvector\b/i.test(text) || capability === 'semantic_search' || capability === 'embeddings') {
    modes.push('vector', 'hybrid');
  }
  return [...new Set(modes)].filter((m) => RETRIEVAL_MODES.includes(m));
}

function calculationsFor(capability, text) {
  const calcs = [];
  if (capability === 'market_analytics' || capability === 'valuation' || /\bmedian\b/i.test(text)) {
    calcs.push('calc:median');
  }
  if (capability === 'market_analytics' || capability === 'scarcity' || /\bcount\b/i.test(text)) {
    calcs.push('calc:count');
  }
  if (capability === 'market_analytics' || /%\s*change|percent(?:age)?\s+change|trend/i.test(text)) {
    calcs.push('calc:percent_change');
  }
  if (capability === 'valuation') {
    calcs.push('calc:fair_range');
  }
  if (capability === 'scarcity') {
    calcs.push('calc:scarcity_score');
  }
  return [...new Set(calcs)];
}

function toolsFor(capability, text) {
  const tools = [];
  if (capability === 'negotiation_assistance' || /\bdraft\b/i.test(text)) {
    tools.push('insert_negotiation_draft');
  }
  if (/\bsave\s+(this\s+)?search\b/i.test(text)) tools.push('save_search');
  if (/\bwatchlist\b/i.test(text) && /\bremove|unwatch\b/i.test(text)) tools.push('watchlist_remove');
  else if (/\bwatchlist|watch\s+this\b/i.test(text)) tools.push('watchlist_add');
  if (/\bpreferenc/i.test(text)) tools.push('update_preference');
  if (/\bre-?embed\b/i.test(text)) tools.push('request_reembed');
  if (/\bedit\s+(the\s+)?listing\b/i.test(text)) tools.push('open_listing_edit');
  if (/\bprice\s+suggestion\b|\bsuggest\s+(a\s+)?price\b/i.test(text)) {
    tools.push('prepare_listing_price_suggestion');
  }
  if (/\bexport\s+(a\s+)?report\b|\bgenerate\s+report\b/i.test(text)) {
    tools.push('generate_report_export');
  }
  return tools;
}

function detectGoals(text, capability, isFollowUp) {
  const goals = [];
  if (isFollowUp) goals.push('refine_previous_answer');
  if (/\bcorrect|actually|instead\b/i.test(text)) goals.push('apply_correction');
  if (capability === 'negotiation_assistance') goals.push('assist_negotiation');
  if (capability === 'market_analytics') goals.push('summarize_market');
  if (capability === 'valuation') goals.push('estimate_value');
  if (capability === 'scarcity') goals.push('assess_scarcity');
  if (capability === 'semantic_search') goals.push('retrieve_matching_items');
  if (capability === 'recommendations') goals.push('recommend_items');
  if (capability === 'auction_intelligence') goals.push('analyze_auctions');
  if (capability === 'embeddings') goals.push('manage_embeddings');
  if (goals.length === 0) goals.push('answer_request');
  return goals;
}

function splitCompoundClauses(text) {
  const parts = String(text || '')
    .split(/\s+(?:and\s+also|also|then|;|\band\b(?=\s+(?:show|tell|compute|find|draft|save)))\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [String(text || '').trim()].filter(Boolean);
}

/**
 * Build a structured query plan.
 *
 * @param {object} input
 * @param {string} [input.request_text]
 * @param {string} [input.capability]
 * @param {object} [input.subject]
 * @param {object} [input.constraints]
 * @param {Array} [input.session_facts] active structured facts from Phase D
 * @param {object} [input.prior_plan] previous turn plan for follow-ups
 * @param {boolean} [input.is_follow_up]
 * @param {string} [input.response_depth]
 */
export function planQuery(input = {}) {
  const text = String(input.request_text || input.user_intent || input.prompt || '');
  const facts = activeFactMap(input.session_facts);
  const isFollowUp = Boolean(
    input.is_follow_up ||
      input.prior_plan ||
      /\b(that|those|same|instead|actually|also)\b/i.test(text),
  );

  const clauses = splitCompoundClauses(text);
  const primaryText = clauses[0] || text;
  const capability = detectCapability(primaryText, input.capability || input.prior_plan?.capability);
  const subject = detectSubject(primaryText, facts, {
    ...(input.prior_plan?.subject || {}),
    ...(input.subject || {}),
  });
  const constraints = {
    ...(input.prior_plan?.constraints || {}),
    ...detectConstraints(primaryText, facts),
    ...(input.constraints || {}),
  };
  const time_range = detectTimeRange(primaryText, facts) || input.prior_plan?.time_range || null;
  const response_depth = detectDepth(text, input.response_depth || input.prior_plan?.response_depth);
  const evidence_types = evidenceTypesFor(capability, constraints);
  const retrieval_modes = retrievalModesFor(capability, text);
  const calculations = calculationsFor(capability, text);
  const tools = toolsFor(capability, text);
  const goals = detectGoals(text, capability, isFollowUp);

  const compound_intents = clauses.slice(1).map((clause) => {
    const cap = detectCapability(clause, capability);
    return {
      request_text: clause,
      capability: cap,
      goals: detectGoals(clause, cap, true),
      tools: toolsFor(cap, clause),
      calculations: calculationsFor(cap, clause),
    };
  });

  const refinements = [];
  if (isFollowUp && input.prior_plan) {
    if (constraints.exact_pressing && !input.prior_plan.constraints?.exact_pressing) {
      refinements.push({ field: 'constraints.exact_pressing', from: false, to: true });
    }
    if (constraints.shipping_amount_usd != null &&
        constraints.shipping_amount_usd !== input.prior_plan.constraints?.shipping_amount_usd) {
      refinements.push({
        field: 'constraints.shipping_amount_usd',
        from: input.prior_plan.constraints?.shipping_amount_usd ?? null,
        to: constraints.shipping_amount_usd,
      });
    }
    if (facts.has('offer_amount_usd')) {
      refinements.push({
        field: 'constraints.offer_amount_usd',
        from: input.prior_plan.constraints?.offer_amount_usd ?? null,
        to: facts.get('offer_amount_usd'),
      });
    }
  }

  return Object.freeze({
    query_plan_version: QUERY_PLAN_VERSION,
    capability,
    goals,
    subject: Object.freeze({ ...subject }),
    constraints: Object.freeze({ ...constraints }),
    evidence_types: Object.freeze([...evidence_types]),
    time_range: time_range ? Object.freeze({ ...time_range }) : null,
    retrieval_modes: Object.freeze([...retrieval_modes]),
    calculations: Object.freeze([...calculations]),
    tools: Object.freeze([...tools]),
    response_depth,
    is_follow_up: isFollowUp,
    compound_intents: Object.freeze(compound_intents.map((c) => Object.freeze({ ...c }))),
    refinements: Object.freeze(refinements.map((r) => Object.freeze({ ...r }))),
    request_text: text,
    session_fact_keys_used: Object.freeze([...facts.keys()].filter((k) =>
      ['release_id', 'pressing_id', 'listing_id', 'currency', 'min_condition',
        'shipping_amount_usd', 'offer_amount_usd', 'exact_pressing', 'time_range',
        'subject_artist', 'subject_title'].includes(k))),
  });
}

export default planQuery;
