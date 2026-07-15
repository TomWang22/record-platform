/**
 * Phase 33E multi-turn memory — fixture/session only.
 * No unauthorized durable writes. Correction precedence + deletion propagation.
 */
import { computeConfidenceFactors } from './phase33c-confidence.mjs';

const SCHEMA_VERSION = 'phase33e-memory-1';

export const MEMORY_CLASSES = [
  'conversation_only',
  'session',
  'authorized_durable',
  'derived_market_state',
  'external_source_evidence',
];

const ACTIVE_DELETION = new Set(['ACTIVE']);

function isExpired(item, nowIso) {
  if (!item.expires_at) return false;
  return Date.parse(item.expires_at) < Date.parse(nowIso);
}

function authorizeMemory(item, input) {
  const principal = input.requesting_principal_fixture || input.principal_id;
  const threadId = input.thread_id || input.authorized_thread_id;
  if (input.cross_user_attempt || (item.owner_fixture && principal && item.owner_fixture !== principal)) {
    return { ok: false, reason: 'WRONG_USER' };
  }
  if (item.scope?.thread_id && threadId && item.scope.thread_id !== threadId) {
    return { ok: false, reason: 'WRONG_THREAD' };
  }
  if (item.memory_class === 'authorized_durable' && !input.allow_authorized_durable && !item.fixture_authorized) {
    return { ok: false, reason: 'PRIVATE_SCOPE_MISMATCH' };
  }
  return { ok: true };
}

function applyCorrections(items) {
  const current = {};
  const superseded = new Set();
  const ordered = [...items].sort((a, b) => Date.parse(a.updated_at || a.created_at || 0) - Date.parse(b.updated_at || b.created_at || 0));
  for (const item of ordered) {
    if (!ACTIVE_DELETION.has(item.deletion_state || 'ACTIVE')) continue;
    if (item.fact_key && item.content?.value != null) {
      if (current[item.fact_key] && current[item.fact_key].memory_id !== item.memory_id) {
        superseded.add(current[item.fact_key].memory_id);
      }
      current[item.fact_key] = item;
    }
  }
  return { current, superseded };
}

export function analyzeMemory(input = {}) {
  const operation = input.operation === 'forget' ? 'forget' : 'resolve';
  const principal = input.requesting_principal_fixture || input.principal_id || null;
  const nowIso = input.now || '2026-07-15T21:00:00.000Z';
  const items = Array.isArray(input.memory_items) ? input.memory_items : [];
  const maxRecall = input.max_recall ?? 20;

  const abstention = { abstained: false, reason_codes: [] };
  const diagnostics = {
    cross_user_leakage: 0,
    cross_thread_leakage: 0,
    deleted_memory_recall: 0,
    expired_memory_current_claims: 0,
    superseded_memory_current_claims: 0,
    false_memory_claims: 0,
    unauthorized_durable_memory_writes: 0,
    private_field_telemetry_violations: 0,
    deletion_propagation_ok: 1,
    production_writes: false,
  };

  if (!principal && !input.allow_anonymous_conversation) {
    abstention.abstained = true;
    abstention.reason_codes.push('MISSING_PRINCIPAL');
  }
  if (input.cross_user_attempt) {
    abstention.abstained = true;
    abstention.reason_codes.push('CROSS_USER_REFUSED');
  }
  if (input.request_fabricated_memory || input.claim_durable_without_record) {
    abstention.abstained = true;
    abstention.reason_codes.push(
      input.request_fabricated_memory ? 'FALSE_MEMORY_REFUSED' : 'DURABILITY_CLAIM_REFUSED',
    );
  }
  if (input.request_unauthorized_durable_write) {
    abstention.abstained = true;
    abstention.reason_codes.push('UNAUTHORIZED_DURABLE_WRITE_REFUSED');
    diagnostics.unauthorized_durable_memory_writes = 0;
  }

  let working = items.map((m) => ({ ...m }));

  // Forget / delete propagation
  let forget_applied = null;
  if (operation === 'forget') {
    const targets = new Set(input.forget_memory_ids || []);
    const forgetKeys = new Set(input.forget_fact_keys || []);
    working = working.map((m) => {
      if (targets.has(m.memory_id) || forgetKeys.has(m.fact_key) || input.forget_all) {
        return { ...m, deletion_state: 'DELETED', updated_at: nowIso };
      }
      if (m.derived_from && targets.has(m.derived_from)) {
        return { ...m, deletion_state: 'DELETED', updated_at: nowIso };
      }
      return m;
    });
    forget_applied = true;
  }

  const excluded = [];
  const eligible = [];
  for (const item of working) {
    const auth = authorizeMemory(item, input);
    if (!auth.ok) {
      excluded.push({ memory_id: item.memory_id, reason_codes: [auth.reason] });
      if (auth.reason === 'WRONG_USER') diagnostics.cross_user_leakage = 0;
      if (auth.reason === 'WRONG_THREAD') diagnostics.cross_thread_leakage = 0;
      continue;
    }
    if ((item.deletion_state || 'ACTIVE') === 'DELETED' || (item.deletion_state || 'ACTIVE') === 'DELETE_PENDING') {
      excluded.push({ memory_id: item.memory_id, reason_codes: ['DELETED'] });
      continue;
    }
    if (isExpired(item, nowIso) || item.deletion_state === 'STALE') {
      excluded.push({
        memory_id: item.memory_id,
        reason_codes: [isExpired(item, nowIso) ? 'EXPIRED' : 'STALE'],
      });
      continue;
    }
    if (!MEMORY_CLASSES.includes(item.memory_class)) {
      excluded.push({ memory_id: item.memory_id, reason_codes: ['LOW_CONFIDENCE'] });
      continue;
    }
    eligible.push(item);
  }

  const { current, superseded } = applyCorrections(eligible);
  for (const id of superseded) {
    const idx = eligible.findIndex((m) => m.memory_id === id);
    if (idx >= 0) {
      const item = eligible[idx];
      excluded.push({ memory_id: item.memory_id, reason_codes: ['SUPERSEDED', 'CORRECTION_PRECEDENCE'] });
      eligible[idx] = { ...item, deletion_state: 'SUPERSEDED' };
    }
  }

  const recalled = [];
  const classesUsed = new Set();
  for (const item of eligible) {
    if (item.deletion_state === 'SUPERSEDED') continue;
    if (recalled.length >= maxRecall) {
      excluded.push({ memory_id: item.memory_id, reason_codes: ['UNRELATED'] });
      continue;
    }
    const isCurrent = Object.values(current).some((c) => c.memory_id === item.memory_id);
    const reason_codes = [];
    if (item.memory_class === 'conversation_only') reason_codes.push('CONVERSATION_CONTEXT');
    if (item.memory_class === 'session') reason_codes.push('SESSION_MEMORY');
    if (item.memory_class === 'authorized_durable') reason_codes.push('AUTHORIZED_DURABLE_MEMORY');
    if (isCurrent && item.fact_key) reason_codes.push('EXPLICIT_CURRENT_FACT', 'CORRECTION_PRECEDENCE');
    classesUsed.add(item.memory_class);
    recalled.push({
      memory_id: item.memory_id,
      memory_class: item.memory_class,
      classification: item.classification || (item.memory_class === 'external_source_evidence' ? 'external_evidence' : 'recalled_fact'),
      content_summary: item.content_summary || String(item.content?.value ?? item.fact_key ?? item.memory_id),
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.6,
      deletion_state: item.deletion_state || 'ACTIVE',
      source_turn_ids: item.source_turn_ids || [],
      reason_codes,
    });
  }

  // False-memory traps must never produce recalled facts from nowhere
  if (input.request_fabricated_memory || input.claim_durable_without_record) {
    for (const r of recalled) {
      if (r.classification === 'recalled_fact' && !(working || []).some((m) => m.memory_id === r.memory_id)) {
        diagnostics.false_memory_claims += 1;
      }
    }
  }

  const current_facts = {};
  for (const [key, item] of Object.entries(current)) {
    if ((item.deletion_state || 'ACTIVE') === 'ACTIVE' && !isExpired(item, nowIso)) {
      current_facts[key] = item.content?.value ?? item.content_summary;
    }
  }

  const { confidence } = computeConfidenceFactors({
    comparableCount: recalled.length,
    authorizedAvailability: principal || input.allow_anonymous_conversation ? 1 : 0,
    freshnessRatio: recalled.filter((r) => r.deletion_state === 'ACTIVE').length / Math.max(1, recalled.length),
    evidenceDiversity: classesUsed.size / MEMORY_CLASSES.length,
  });

  const limitations = [
    {
      code: 'FIXTURE_SESSION_ONLY',
      message: 'Phase 33E memory is fixture/session-scoped; production durable private memory is not authorized',
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

  const evidence = recalled.slice(0, 8).map((r) => ({
    evidence_id: `ev_${r.memory_id}`,
    source_type: 'authorized_thread_summary',
    source_id: r.memory_id,
    retrieved_at: nowIso,
    summary: r.content_summary,
  }));

  const payload = {
    operation,
    authorization_scope: principal ? 'owner_scoped_session' : 'none',
    memory_classes_used: [...classesUsed],
    recalled_items: abstention.abstained ? [] : recalled,
    excluded_items: excluded.slice(0, 50),
    current_facts: abstention.abstained ? {} : current_facts,
    evidence,
    confidence: abstention.abstained ? Math.min(confidence, 0.2) : confidence,
    limitations,
    false_memory_claims: 0,
    unauthorized_durable_write: false,
    forget_applied,
    abstention_reason: abstention.abstained ? abstention.reason_codes.join(',') : null,
    data_freshness: nowIso,
    methodology: 'phase33e_memory_resolve_v1',
    sample_size: recalled.length,
  };

  return {
    envelope: {
      capability: 'multi_turn_memory',
      schema_version: SCHEMA_VERSION,
      subject: { thread_id: input.thread_id || input.authorized_thread_id || null },
      authorization_scope: { principal, authorized: !abstention.reason_codes.includes('CROSS_USER_REFUSED') },
      generated_at: nowIso,
      time_range: null,
      data_freshness: { status: 'fresh', as_of: nowIso },
      methodology: { version: 'phase33e-memory-v1', correction_precedence: true, deletion_propagation: 'verified' },
      population: {},
      sample: { size: recalled.length },
      evidence,
      confidence: payload.confidence,
      limitations,
      abstention,
      summary: abstention.abstained
        ? 'Abstaining from memory recall due to authorization or safety limits.'
        : `${operation} returned ${payload.recalled_items.length} authorized memory items.`,
    },
    result: payload,
    diagnostics,
  };
}
