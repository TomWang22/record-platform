/**
 * Phase D — authoritative multi-turn conversation memory and corrections.
 * In-memory store + serializable JSON shape; Postgres mirror in
 * infra/db/52-intelligence-conversation-memory.sql.
 *
 * Not prompt-regex templates: facts carry provenance, authority, supersession.
 */
import crypto from 'node:crypto';

export const MEMORY_SCHEMA_VERSION = 'phase34-conversation-memory-v1';

/** Hard-coded correction precedence (lower rank = higher authority). */
export const FACT_AUTHORITY = Object.freeze({
  CURRENT_EXPLICIT_CUSTOMER_CORRECTION: 1,
  CURRENT_EXPLICIT_CUSTOMER_STATEMENT: 2,
  PERSISTED_AUTHORIZED_THREAD_FACT: 3,
  FIRST_PARTY_MARKETPLACE_EVENT: 4,
  GROUNDED_INFERENCE: 5,
  MODEL_INFERENCE: 6,
});

export const AUTHORITY_ORDER = Object.freeze([
  'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
  'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
  'PERSISTED_AUTHORIZED_THREAD_FACT',
  'FIRST_PARTY_MARKETPLACE_EVENT',
  'GROUNDED_INFERENCE',
  'MODEL_INFERENCE',
]);

export const MEMORY_SCOPE = Object.freeze({
  TURN: 'TURN',
  SESSION: 'SESSION',
  THREAD: 'THREAD',
  USER_PRIVATE: 'USER_PRIVATE',
  ACCOUNT: 'ACCOUNT',
  NONE: 'NONE',
});

export const DRAFT_STATUS = Object.freeze({
  GENERATED: 'GENERATED',
  EDITED: 'EDITED',
  INSERTED: 'INSERTED',
  CONFIRMED: 'CONFIRMED',
  SENT: 'SENT',
  CANCELLED: 'CANCELLED',
});

export const CONTEXT_BUDGETS = Object.freeze({
  '4k': 4_000,
  '8k': 8_000,
  '16k': 16_000,
  '32k': 32_000,
});

const INFERENCE_AUTHORITIES = new Set([
  'GROUNDED_INFERENCE',
  'MODEL_INFERENCE',
]);

const DIRECT_CUSTOMER_AUTHORITIES = new Set([
  'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
  'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
]);

function nowIso(inputNow) {
  return inputNow || new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

function authorityRank(authority) {
  const rank = FACT_AUTHORITY[authority];
  if (rank == null) {
    const err = new Error(`UNKNOWN_FACT_AUTHORITY:${authority}`);
    err.code = 'UNKNOWN_FACT_AUTHORITY';
    throw err;
  }
  return rank;
}

function estimateTokens(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.max(0, Math.ceil(s.length / 4));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isExpired(fact, atIso) {
  if (!fact?.expires_at) return false;
  return Date.parse(fact.expires_at) <= Date.parse(atIso);
}

/**
 * Serializable session document matching directive entities.
 */
export function createConversationSession({
  session_id = null,
  principal_id,
  thread_id = null,
  account_id = null,
  participant_side = null,
  created_at = null,
  metadata = {},
} = {}) {
  if (!principal_id) {
    const err = new Error('MISSING_PRINCIPAL');
    err.code = 'MISSING_PRINCIPAL';
    throw err;
  }
  const created = created_at || nowIso();
  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    conversation_session: {
      session_id: session_id || newId('sess'),
      principal_id,
      thread_id,
      account_id,
      participant_side,
      created_at: created,
      updated_at: created,
      state_version: 0,
      consent: {
        durable_memory: false,
        cross_session_recall: false,
        scopes_allowed: [MEMORY_SCOPE.TURN, MEMORY_SCOPE.SESSION, MEMORY_SCOPE.THREAD],
      },
      metadata: { ...metadata },
    },
    conversation_turns: [],
    structured_facts: [],
    fact_revisions: [],
    memory_scopes: [],
    retrieval_checkpoints: [],
    responses: [],
    drafts: [],
    action_confirmations: [],
  };
}

export function appendConversationTurn(sessionDoc, {
  turn_id = null,
  actor,
  role = 'customer',
  intent = null,
  content = null,
  created_at = null,
  metadata = {},
} = {}) {
  assertSessionDoc(sessionDoc);
  const turn = {
    turn_id: turn_id || newId('turn'),
    session_id: sessionDoc.conversation_session.session_id,
    turn_index: sessionDoc.conversation_turns.length,
    actor,
    role,
    intent,
    content,
    created_at: created_at || nowIso(),
    metadata: { ...metadata },
  };
  sessionDoc.conversation_turns.push(turn);
  bumpSessionVersion(sessionDoc, turn.created_at);
  return turn;
}

export function buildStructuredFact({
  fact_id = null,
  session_id,
  key,
  value,
  value_type = null,
  source_turn_id = null,
  source_actor = null,
  timestamp = null,
  confidence = 1,
  authority,
  supersedes_fact_id = null,
  active = true,
  expires_at = null,
  privacy_scope = MEMORY_SCOPE.SESSION,
  thread_id = null,
  principal_id = null,
  metadata = {},
} = {}) {
  if (!key) {
    const err = new Error('MISSING_FACT_KEY');
    err.code = 'MISSING_FACT_KEY';
    throw err;
  }
  authorityRank(authority);
  const typed =
    value_type ||
    (value === null || value === undefined
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value);
  return {
    fact_id: fact_id || newId('fact'),
    session_id: session_id || null,
    key,
    value,
    value_type: typed,
    source_turn_id,
    source_actor,
    timestamp: timestamp || nowIso(),
    confidence: typeof confidence === 'number' ? confidence : 1,
    authority,
    supersedes_fact_id,
    active: active !== false,
    expires_at,
    privacy_scope,
    thread_id,
    principal_id,
    deletion_state: 'ACTIVE',
    metadata: { ...metadata },
  };
}

export function recordFactRevision(sessionDoc, {
  fact_id,
  previous_value = null,
  next_value = null,
  reason = null,
  authority = null,
  turn_id = null,
  created_at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const revision = {
    revision_id: newId('frev'),
    fact_id,
    session_id: sessionDoc.conversation_session.session_id,
    previous_value,
    next_value,
    reason,
    authority,
    turn_id,
    created_at: created_at || nowIso(),
  };
  sessionDoc.fact_revisions.push(revision);
  bumpSessionVersion(sessionDoc, revision.created_at);
  return revision;
}

export function registerMemoryScope(sessionDoc, {
  scope,
  consent = false,
  source_label = null,
  expires_at = null,
  principal_id = null,
  thread_id = null,
  account_id = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  if (!MEMORY_SCOPE[scope]) {
    const err = new Error(`UNKNOWN_MEMORY_SCOPE:${scope}`);
    err.code = 'UNKNOWN_MEMORY_SCOPE';
    throw err;
  }
  const row = {
    scope_id: newId('scope'),
    session_id: sessionDoc.conversation_session.session_id,
    scope,
    consent: Boolean(consent),
    source_label,
    expires_at,
    principal_id: principal_id || sessionDoc.conversation_session.principal_id,
    thread_id: thread_id || sessionDoc.conversation_session.thread_id,
    account_id: account_id || sessionDoc.conversation_session.account_id,
    created_at: nowIso(),
  };
  sessionDoc.memory_scopes.push(row);
  return row;
}

export function createRetrievalCheckpoint(sessionDoc, {
  turn_id = null,
  reason = 'material_correction',
  query_plan = null,
  evidence_snapshot_id = null,
  created_at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const checkpoint = {
    checkpoint_id: newId('rchk'),
    session_id: sessionDoc.conversation_session.session_id,
    turn_id,
    reason,
    query_plan,
    evidence_snapshot_id,
    created_at: created_at || nowIso(),
  };
  sessionDoc.retrieval_checkpoints.push(checkpoint);
  bumpSessionVersion(sessionDoc, checkpoint.created_at);
  return checkpoint;
}

export function recordResponse(sessionDoc, {
  response_id = null,
  turn_id = null,
  capability = null,
  payload = null,
  session_state_version = null,
  created_at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const response = {
    response_id: response_id || newId('resp'),
    session_id: sessionDoc.conversation_session.session_id,
    turn_id,
    capability,
    payload,
    session_state_version:
      session_state_version ?? String(sessionDoc.conversation_session.state_version),
    created_at: created_at || nowIso(),
  };
  sessionDoc.responses.push(response);
  return response;
}

export function createDraft(sessionDoc, {
  draft_id = null,
  turn_id = null,
  body,
  status = DRAFT_STATUS.GENERATED,
  created_at = null,
  metadata = {},
} = {}) {
  assertSessionDoc(sessionDoc);
  if (!DRAFT_STATUS[status]) {
    const err = new Error(`UNKNOWN_DRAFT_STATUS:${status}`);
    err.code = 'UNKNOWN_DRAFT_STATUS';
    throw err;
  }
  const draft = {
    draft_id: draft_id || newId('draft'),
    session_id: sessionDoc.conversation_session.session_id,
    turn_id,
    body,
    status,
    message_sent: false,
    inserted_at: null,
    confirmed_at: null,
    sent_at: null,
    created_at: created_at || nowIso(),
    updated_at: created_at || nowIso(),
    metadata: { ...metadata },
  };
  sessionDoc.drafts.push(draft);
  bumpSessionVersion(sessionDoc, draft.created_at);
  return draft;
}

const DRAFT_TRANSITIONS = Object.freeze({
  GENERATED: new Set(['EDITED', 'INSERTED', 'CANCELLED']),
  EDITED: new Set(['EDITED', 'INSERTED', 'CANCELLED']),
  INSERTED: new Set(['EDITED', 'CONFIRMED', 'CANCELLED']),
  CONFIRMED: new Set(['SENT', 'CANCELLED']),
  SENT: new Set([]),
  CANCELLED: new Set([]),
});

/**
 * Advance draft lifecycle. Insert is never send; SENT requires CONFIRMED.
 */
export function transitionDraft(sessionDoc, draft_id, nextStatus, { at = null, body = null } = {}) {
  assertSessionDoc(sessionDoc);
  const draft = sessionDoc.drafts.find((d) => d.draft_id === draft_id);
  if (!draft) {
    const err = new Error(`DRAFT_NOT_FOUND:${draft_id}`);
    err.code = 'DRAFT_NOT_FOUND';
    throw err;
  }
  if (!DRAFT_STATUS[nextStatus]) {
    const err = new Error(`UNKNOWN_DRAFT_STATUS:${nextStatus}`);
    err.code = 'UNKNOWN_DRAFT_STATUS';
    throw err;
  }
  const allowed = DRAFT_TRANSITIONS[draft.status] || new Set();
  if (!allowed.has(nextStatus)) {
    const err = new Error(`ILLEGAL_DRAFT_TRANSITION:${draft.status}->${nextStatus}`);
    err.code = 'ILLEGAL_DRAFT_TRANSITION';
    throw err;
  }
  if (nextStatus === DRAFT_STATUS.SENT && draft.status !== DRAFT_STATUS.CONFIRMED) {
    const err = new Error('SEND_REQUIRES_CONFIRMATION');
    err.code = 'SEND_REQUIRES_CONFIRMATION';
    throw err;
  }
  const ts = at || nowIso();
  draft.status = nextStatus;
  draft.updated_at = ts;
  if (body != null) draft.body = body;
  if (nextStatus === DRAFT_STATUS.INSERTED) {
    draft.inserted_at = ts;
    draft.message_sent = false;
  }
  if (nextStatus === DRAFT_STATUS.CONFIRMED) {
    draft.confirmed_at = ts;
    draft.message_sent = false;
  }
  if (nextStatus === DRAFT_STATUS.SENT) {
    draft.sent_at = ts;
    draft.message_sent = true;
  }
  bumpSessionVersion(sessionDoc, ts);
  return draft;
}

/**
 * Side-effecting actions require explicit confirmation records.
 * Inserting a draft does not create a send confirmation.
 */
export function requireActionConfirmation(sessionDoc, {
  action_type,
  draft_id = null,
  confirmed = false,
  actor = null,
  created_at = null,
  metadata = {},
} = {}) {
  assertSessionDoc(sessionDoc);
  if (action_type === 'send_message' && !confirmed) {
    const err = new Error('ACTION_CONFIRMATION_REQUIRED');
    err.code = 'ACTION_CONFIRMATION_REQUIRED';
    throw err;
  }
  if (action_type === 'send_message' && draft_id) {
    const draft = sessionDoc.drafts.find((d) => d.draft_id === draft_id);
    if (!draft || draft.status !== DRAFT_STATUS.CONFIRMED) {
      const err = new Error('SEND_REQUIRES_CONFIRMED_DRAFT');
      err.code = 'SEND_REQUIRES_CONFIRMED_DRAFT';
      throw err;
    }
  }
  const row = {
    confirmation_id: newId('aconf'),
    session_id: sessionDoc.conversation_session.session_id,
    action_type,
    draft_id,
    confirmed: Boolean(confirmed),
    actor,
    created_at: created_at || nowIso(),
    metadata: { ...metadata },
  };
  sessionDoc.action_confirmations.push(row);
  return row;
}

/**
 * Reject inference (or weaker authority) overriding a stronger direct correction/statement.
 */
export function assertAuthorityMayOverride(existingFact, incomingAuthority) {
  if (!existingFact || existingFact.active === false) return true;
  const existingRank = authorityRank(existingFact.authority);
  const incomingRank = authorityRank(incomingAuthority);
  if (
    DIRECT_CUSTOMER_AUTHORITIES.has(existingFact.authority) &&
    INFERENCE_AUTHORITIES.has(incomingAuthority)
  ) {
    const err = new Error(
      `ILLEGAL_AUTHORITY_OVERRIDE:${incomingAuthority}_cannot_override_${existingFact.authority}`,
    );
    err.code = 'ILLEGAL_AUTHORITY_OVERRIDE';
    err.existing_fact_id = existingFact.fact_id;
    err.existing_authority = existingFact.authority;
    err.incoming_authority = incomingAuthority;
    throw err;
  }
  // Equal or weaker rank (higher number) may not silently clobber stronger without correction path.
  if (incomingRank > existingRank && !DIRECT_CUSTOMER_AUTHORITIES.has(incomingAuthority)) {
    const err = new Error(
      `ILLEGAL_AUTHORITY_OVERRIDE:rank_${incomingRank}_weaker_than_${existingRank}`,
    );
    err.code = 'ILLEGAL_AUTHORITY_OVERRIDE';
    err.existing_fact_id = existingFact.fact_id;
    err.existing_authority = existingFact.authority;
    err.incoming_authority = incomingAuthority;
    throw err;
  }
  return true;
}

/**
 * Apply a correction: supersede prior active fact for the same key, append revision.
 */
export function applyCorrection(sessionDoc, {
  key,
  value,
  value_type = null,
  source_turn_id = null,
  source_actor = null,
  timestamp = null,
  confidence = 1,
  authority = 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
  privacy_scope = MEMORY_SCOPE.SESSION,
  expires_at = null,
  metadata = {},
  allow_weaker_override = false,
} = {}) {
  assertSessionDoc(sessionDoc);
  authorityRank(authority);
  const at = timestamp || nowIso();
  const active = resolveActiveFacts(sessionDoc, { at });
  const prior = active[key] || null;

  if (prior && !allow_weaker_override) {
    assertAuthorityMayOverride(prior, authority);
  }

  if (prior) {
    prior.active = false;
    prior.deletion_state = 'SUPERSEDED';
    recordFactRevision(sessionDoc, {
      fact_id: prior.fact_id,
      previous_value: prior.value,
      next_value: value,
      reason: 'correction_supersession',
      authority,
      turn_id: source_turn_id,
      created_at: at,
    });
  }

  const next = buildStructuredFact({
    session_id: sessionDoc.conversation_session.session_id,
    key,
    value,
    value_type,
    source_turn_id,
    source_actor: source_actor || sessionDoc.conversation_session.principal_id,
    timestamp: at,
    confidence,
    authority,
    supersedes_fact_id: prior?.fact_id || null,
    active: true,
    expires_at,
    privacy_scope,
    thread_id: sessionDoc.conversation_session.thread_id,
    principal_id: sessionDoc.conversation_session.principal_id,
    metadata,
  });
  sessionDoc.structured_facts.push(next);
  bumpSessionVersion(sessionDoc, at);
  return { fact: next, superseded: prior };
}

/**
 * Resolve active facts by key using authority order + recency.
 * Later explicit corrections always win over earlier values when ranks allow.
 */
export function resolveActiveFacts(sessionDoc, { at = null, include_expired = false } = {}) {
  assertSessionDoc(sessionDoc);
  const atIso = at || nowIso();
  const byKey = new Map();

  const ordered = [...sessionDoc.structured_facts].sort((a, b) => {
    const ta = Date.parse(a.timestamp || 0);
    const tb = Date.parse(b.timestamp || 0);
    if (ta !== tb) return ta - tb;
    return authorityRank(a.authority) - authorityRank(b.authority);
  });

  for (const fact of ordered) {
    if (fact.deletion_state === 'DELETED' || fact.deletion_state === 'FORGOTTEN') continue;
    if (fact.active === false && fact.deletion_state === 'SUPERSEDED') continue;
    if (!include_expired && isExpired(fact, atIso)) continue;
    if (fact.active === false) continue;

    const current = byKey.get(fact.key);
    if (!current) {
      byKey.set(fact.key, fact);
      continue;
    }
    const currentRank = authorityRank(current.authority);
    const nextRank = authorityRank(fact.authority);
    // Prefer stronger authority; on tie prefer later timestamp (already sorted).
    if (nextRank < currentRank || (nextRank === currentRank && Date.parse(fact.timestamp) >= Date.parse(current.timestamp))) {
      if (current.active) {
        current.active = false;
        current.deletion_state = current.deletion_state === 'DELETED' ? 'DELETED' : 'SUPERSEDED';
      }
      byKey.set(fact.key, fact);
    } else {
      fact.active = false;
      fact.deletion_state = 'SUPERSEDED';
    }
  }

  const out = {};
  for (const [key, fact] of byKey.entries()) {
    if (fact.active !== false && fact.deletion_state !== 'SUPERSEDED') {
      out[key] = fact;
    }
  }
  return out;
}

export function activeFactsMap(sessionDoc, opts = {}) {
  const active = resolveActiveFacts(sessionDoc, opts);
  const map = {};
  for (const [key, fact] of Object.entries(active)) {
    map[key] = fact.value;
  }
  return map;
}

/**
 * After a material correction: checkpoint retrieval + return recomputed active map
 * and flags for callers to rebuild drafts/economics.
 */
export function recomputeAfterCorrection(sessionDoc, {
  correction_fact = null,
  turn_id = null,
  material_keys = null,
  evidence_snapshot_id = null,
  at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const atIso = at || nowIso();
  const active = resolveActiveFacts(sessionDoc, { at: atIso });
  const values = {};
  for (const [k, f] of Object.entries(active)) values[k] = f.value;

  const keys = material_keys || (correction_fact ? [correction_fact.key] : Object.keys(values));
  const material = keys.some((k) =>
    [
      'shipping_cost_usd',
      'offer_amount_usd',
      'listing_price_usd',
      'seller_floor_usd',
      'condition',
      'condition_notes',
      'seam_split',
    ].includes(k),
  );

  let checkpoint = null;
  if (material) {
    checkpoint = createRetrievalCheckpoint(sessionDoc, {
      turn_id: turn_id || correction_fact?.source_turn_id || null,
      reason: 'material_correction',
      query_plan: {
        recompute: true,
        keys,
        correction_fact_id: correction_fact?.fact_id || null,
      },
      evidence_snapshot_id,
      created_at: atIso,
    });
  }

  return {
    material_correction: material,
    active_facts: active,
    values,
    retrieval_checkpoint: checkpoint,
    session_state_version: sessionStateVersion(sessionDoc),
    must_rewrite_draft: material,
    must_recompute_economics: material && keys.some((k) =>
      ['shipping_cost_usd', 'offer_amount_usd', 'listing_price_usd', 'seller_floor_usd'].includes(k),
    ),
  };
}

/**
 * Context assembly with tier budgets — not a full history dump.
 */
export function assembleContext(sessionDoc, {
  budget = '16k',
  recent_turn_limit = 8,
  retrieved_memories = [],
  evidence_excerpts = [],
  compact_summary = null,
  at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const tokenBudget =
    typeof budget === 'number' ? budget : CONTEXT_BUDGETS[String(budget)] || CONTEXT_BUDGETS['16k'];
  const atIso = at || nowIso();
  const active = resolveActiveFacts(sessionDoc, { at: atIso });
  const activeList = Object.values(active).map((f) => ({
    key: f.key,
    value: f.value,
    authority: f.authority,
    confidence: f.confidence,
    source_turn_id: f.source_turn_id,
    timestamp: f.timestamp,
  }));

  const turns = sessionDoc.conversation_turns.slice(-recent_turn_limit).map((t) => ({
    turn_id: t.turn_id,
    turn_index: t.turn_index,
    actor: t.actor,
    role: t.role,
    intent: t.intent,
    content: t.content,
    created_at: t.created_at,
  }));

  const olderCount = Math.max(0, sessionDoc.conversation_turns.length - turns.length);
  const summary =
    compact_summary ||
    (olderCount > 0
      ? `Earlier ${olderCount} turn(s) compacted; active structured facts retained.`
      : null);

  const drafts = sessionDoc.drafts
    .filter((d) => d.status !== DRAFT_STATUS.CANCELLED)
    .slice(-3)
    .map((d) => ({
      draft_id: d.draft_id,
      status: d.status,
      message_sent: d.message_sent,
      body_excerpt: String(d.body || '').slice(0, 240),
    }));

  const packs = {
    recent_turns: turns,
    active_facts: activeList,
    compact_summary: summary,
    retrieved_memories: Array.isArray(retrieved_memories) ? retrieved_memories.slice(0, 12) : [],
    evidence_excerpts: Array.isArray(evidence_excerpts) ? evidence_excerpts.slice(0, 12) : [],
    action_state: {
      drafts,
      last_checkpoint: sessionDoc.retrieval_checkpoints.slice(-1)[0] || null,
    },
    correction_history: sessionDoc.fact_revisions.slice(-20),
  };

  // Budget trim: drop retrieved memories then evidence before touching active facts/turns.
  let estimate =
    estimateTokens(packs.recent_turns) +
    estimateTokens(packs.active_facts) +
    estimateTokens(packs.compact_summary || '') +
    estimateTokens(packs.retrieved_memories) +
    estimateTokens(packs.evidence_excerpts) +
    estimateTokens(packs.action_state) +
    estimateTokens(packs.correction_history);

  const trimOrder = ['retrieved_memories', 'evidence_excerpts', 'correction_history'];
  for (const field of trimOrder) {
    while (estimate > tokenBudget && packs[field].length > 0) {
      packs[field].pop();
      estimate =
        estimateTokens(packs.recent_turns) +
        estimateTokens(packs.active_facts) +
        estimateTokens(packs.compact_summary || '') +
        estimateTokens(packs.retrieved_memories) +
        estimateTokens(packs.evidence_excerpts) +
        estimateTokens(packs.action_state) +
        estimateTokens(packs.correction_history);
    }
  }

  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    session_id: sessionDoc.conversation_session.session_id,
    session_state_version: sessionStateVersion(sessionDoc),
    budget_tokens: tokenBudget,
    input_token_estimate: estimate,
    truncation_status: estimate > tokenBudget ? 'OVER_BUDGET_TRIMMED' : 'WITHIN_BUDGET',
    tiers: packs,
    values: activeFactsMap(sessionDoc, { at: atIso }),
  };
}

export function buildContextBudgetHelpers() {
  return {
    assemble4k: (sessionDoc, opts = {}) => assembleContext(sessionDoc, { ...opts, budget: '4k' }),
    assemble8k: (sessionDoc, opts = {}) => assembleContext(sessionDoc, { ...opts, budget: '8k' }),
    assemble16k: (sessionDoc, opts = {}) => assembleContext(sessionDoc, { ...opts, budget: '16k' }),
    assemble32k: (sessionDoc, opts = {}) => assembleContext(sessionDoc, { ...opts, budget: '32k' }),
  };
}

/**
 * Consent update + scope allow-list.
 */
export function grantConsent(sessionDoc, { durable_memory = false, cross_session_recall = false, scopes_allowed = null } = {}) {
  assertSessionDoc(sessionDoc);
  const c = sessionDoc.conversation_session.consent;
  c.durable_memory = Boolean(durable_memory);
  c.cross_session_recall = Boolean(cross_session_recall);
  if (Array.isArray(scopes_allowed)) c.scopes_allowed = [...scopes_allowed];
  bumpSessionVersion(sessionDoc);
  return c;
}

/**
 * Forget facts by id/key; soft-delete with deletion propagation stub for derived facts.
 */
export function forgetFacts(sessionDoc, {
  fact_ids = [],
  fact_keys = [],
  forget_all = false,
  at = null,
  propagate = true,
} = {}) {
  assertSessionDoc(sessionDoc);
  const atIso = at || nowIso();
  const idSet = new Set(fact_ids);
  const keySet = new Set(fact_keys);
  const forgotten = [];

  for (const fact of sessionDoc.structured_facts) {
    const hit =
      forget_all ||
      idSet.has(fact.fact_id) ||
      keySet.has(fact.key);
    if (!hit) continue;
    fact.active = false;
    fact.deletion_state = 'FORGOTTEN';
    forgotten.push(fact.fact_id);
    recordFactRevision(sessionDoc, {
      fact_id: fact.fact_id,
      previous_value: fact.value,
      next_value: null,
      reason: 'forget',
      authority: fact.authority,
      created_at: atIso,
    });
  }

  // Deletion propagation stub: mark facts that supersede a forgotten id as forgotten too
  // when they were derived (inference) from it.
  if (propagate) {
    const forgottenSet = new Set(forgotten);
    for (const fact of sessionDoc.structured_facts) {
      if (
        fact.supersedes_fact_id &&
        forgottenSet.has(fact.supersedes_fact_id) &&
        INFERENCE_AUTHORITIES.has(fact.authority) &&
        fact.deletion_state !== 'FORGOTTEN'
      ) {
        fact.active = false;
        fact.deletion_state = 'FORGOTTEN';
        forgotten.push(fact.fact_id);
      }
    }
  }

  bumpSessionVersion(sessionDoc, atIso);
  return {
    forgotten_fact_ids: forgotten,
    deletion_propagation: propagate ? 'stub_applied' : 'skipped',
    active_values: activeFactsMap(sessionDoc, { at: atIso }),
  };
}

/**
 * Cross-user / cross-thread isolation check.
 */
export function assertMemoryIsolation(sessionDoc, {
  requesting_principal_id,
  requesting_thread_id = null,
  allow_cross_thread = false,
} = {}) {
  assertSessionDoc(sessionDoc);
  const session = sessionDoc.conversation_session;
  const diagnostics = {
    cross_user_leakage: 0,
    cross_thread_leakage: 0,
    isolated: true,
    refused: false,
    reason_codes: [],
  };

  if (requesting_principal_id && session.principal_id && requesting_principal_id !== session.principal_id) {
    diagnostics.isolated = false;
    diagnostics.refused = true;
    diagnostics.reason_codes.push('CROSS_USER_REFUSED');
  }

  if (
    !allow_cross_thread &&
    requesting_thread_id &&
    session.thread_id &&
    requesting_thread_id !== session.thread_id
  ) {
    diagnostics.isolated = false;
    diagnostics.refused = true;
    diagnostics.reason_codes.push('CROSS_THREAD_REFUSED');
  }

  const visibleFacts = [];
  for (const fact of sessionDoc.structured_facts) {
    if (fact.principal_id && requesting_principal_id && fact.principal_id !== requesting_principal_id) {
      diagnostics.cross_user_leakage += 1;
      continue;
    }
    if (
      !allow_cross_thread &&
      fact.thread_id &&
      requesting_thread_id &&
      fact.thread_id !== requesting_thread_id
    ) {
      diagnostics.cross_thread_leakage += 1;
      continue;
    }
    if (fact.privacy_scope === MEMORY_SCOPE.USER_PRIVATE && fact.principal_id !== requesting_principal_id) {
      diagnostics.cross_user_leakage += 1;
      continue;
    }
    visibleFacts.push(fact);
  }

  if (diagnostics.cross_user_leakage > 0 || diagnostics.cross_thread_leakage > 0) {
    diagnostics.isolated = false;
  }

  return {
    ok: diagnostics.isolated && !diagnostics.refused,
    diagnostics,
    visible_facts: diagnostics.refused ? [] : visibleFacts,
  };
}

export function sessionStateVersion(sessionDoc) {
  assertSessionDoc(sessionDoc);
  return `${MEMORY_SCHEMA_VERSION}:${sessionDoc.conversation_session.session_id}:v${sessionDoc.conversation_session.state_version}`;
}

export function serializeSession(sessionDoc) {
  assertSessionDoc(sessionDoc);
  return cloneJson(sessionDoc);
}

export function hydrateSession(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : cloneJson(json);
  assertSessionDoc(doc);
  return doc;
}

/**
 * Seed a session from plain conversation facts / prior session_state (negotiation bridge).
 */
export function ingestConversationFacts(sessionDoc, facts = [], {
  default_authority = 'PERSISTED_AUTHORIZED_THREAD_FACT',
  source_turn_id = null,
  source_actor = null,
  at = null,
} = {}) {
  assertSessionDoc(sessionDoc);
  const atIso = at || nowIso();
  const list = Array.isArray(facts)
    ? facts
    : Object.entries(facts || {}).map(([key, value]) => ({ key, value }));

  for (const item of list) {
    const authority = item.authority || default_authority;
    const active = resolveActiveFacts(sessionDoc, { at: atIso });
    const prior = active[item.key];
    if (prior) {
      try {
        assertAuthorityMayOverride(prior, authority);
      } catch (err) {
        if (err.code === 'ILLEGAL_AUTHORITY_OVERRIDE') {
          // Skip illegal weaker ingest; keep prior correction.
          continue;
        }
        throw err;
      }
      prior.active = false;
      prior.deletion_state = 'SUPERSEDED';
    }
    const fact = buildStructuredFact({
      session_id: sessionDoc.conversation_session.session_id,
      key: item.key,
      value: item.value,
      value_type: item.value_type,
      source_turn_id: item.source_turn_id || source_turn_id,
      source_actor: item.source_actor || source_actor || sessionDoc.conversation_session.principal_id,
      timestamp: item.timestamp || atIso,
      confidence: item.confidence ?? 1,
      authority,
      supersedes_fact_id: prior?.fact_id || null,
      privacy_scope: item.privacy_scope || MEMORY_SCOPE.SESSION,
      thread_id: sessionDoc.conversation_session.thread_id,
      principal_id: sessionDoc.conversation_session.principal_id,
      metadata: item.metadata || {},
    });
    sessionDoc.structured_facts.push(fact);
  }
  bumpSessionVersion(sessionDoc, atIso);
  return activeFactsMap(sessionDoc, { at: atIso });
}

/**
 * Load or build session_state for negotiation without breaking offline callers.
 */
export function ensureSessionFromNegotiationInput(input = {}) {
  if (input.session_state) {
    return hydrateSession(input.session_state);
  }

  const hasFacts =
    (Array.isArray(input.conversation_facts) && input.conversation_facts.length > 0) ||
    (input.conversation_facts && typeof input.conversation_facts === 'object' && Object.keys(input.conversation_facts).length > 0) ||
    (Array.isArray(input.structured_memory_facts) && input.structured_memory_facts.length > 0);

  if (!hasFacts && !input.memory_session_id) {
    return null;
  }

  const principal =
    input.requesting_principal_fixture ||
    input.principal_id ||
    input.session_principal_id ||
    'anonymous-fixture';
  const sessionDoc = createConversationSession({
    session_id: input.memory_session_id || input.session_id || null,
    principal_id: principal,
    thread_id: input.authorized_thread_id || input.thread_id || input.thread?.thread_id || null,
    participant_side: input.participant_side || input.requesting_side || null,
    created_at: input.now || null,
  });

  if (input.conversation_facts) {
    ingestConversationFacts(sessionDoc, input.conversation_facts, {
      source_actor: principal,
      at: input.now || null,
    });
  }
  if (Array.isArray(input.structured_memory_facts)) {
    ingestConversationFacts(sessionDoc, input.structured_memory_facts, {
      source_actor: principal,
      at: input.now || null,
    });
  }
  return sessionDoc;
}

function bumpSessionVersion(sessionDoc, at = null) {
  sessionDoc.conversation_session.state_version += 1;
  sessionDoc.conversation_session.updated_at = at || nowIso();
}

function assertSessionDoc(sessionDoc) {
  if (!sessionDoc?.conversation_session?.session_id) {
    const err = new Error('INVALID_SESSION_DOC');
    err.code = 'INVALID_SESSION_DOC';
    throw err;
  }
  if (!Array.isArray(sessionDoc.structured_facts)) sessionDoc.structured_facts = [];
  if (!Array.isArray(sessionDoc.conversation_turns)) sessionDoc.conversation_turns = [];
  if (!Array.isArray(sessionDoc.fact_revisions)) sessionDoc.fact_revisions = [];
  if (!Array.isArray(sessionDoc.memory_scopes)) sessionDoc.memory_scopes = [];
  if (!Array.isArray(sessionDoc.retrieval_checkpoints)) sessionDoc.retrieval_checkpoints = [];
  if (!Array.isArray(sessionDoc.responses)) sessionDoc.responses = [];
  if (!Array.isArray(sessionDoc.drafts)) sessionDoc.drafts = [];
  if (!Array.isArray(sessionDoc.action_confirmations)) sessionDoc.action_confirmations = [];
}

/** In-memory store helper for tests / local runners. */
export class ConversationMemoryStore {
  constructor() {
    this.sessions = new Map();
  }

  put(sessionDoc) {
    assertSessionDoc(sessionDoc);
    this.sessions.set(sessionDoc.conversation_session.session_id, sessionDoc);
    return sessionDoc;
  }

  get(session_id) {
    return this.sessions.get(session_id) || null;
  }

  delete(session_id) {
    return this.sessions.delete(session_id);
  }

  toJSON() {
    return [...this.sessions.values()].map(serializeSession);
  }
}
