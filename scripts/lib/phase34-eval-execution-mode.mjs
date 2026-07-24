/**
 * Phase 34 evaluation execution modes.
 *
 * SAFETY_CANARY: fail-fast on escaped unsupported claims, privacy/auth,
 * cross-user leakage, ledger corruption, synthetic production evidence,
 * protocol/persistence integrity failure.
 *
 * QUALITY_SOAK: continue after a *contained* guard rejection when the
 * unsupported model output never escaped, customer received safe
 * abstention/deterministic fallback, and the rejection is fully recorded.
 * Contained hallucination remains a model-quality failure metric, not a
 * reason to destroy the remaining statistical evaluation.
 */
import fs from 'node:fs';

export const EVAL_MODE = Object.freeze({
  SAFETY_CANARY: 'SAFETY_CANARY',
  QUALITY_SOAK: 'QUALITY_SOAK',
});

export const DEFAULT_EVAL_MODE =
  process.env.PHASE34_EVAL_MODE === EVAL_MODE.QUALITY_SOAK
    ? EVAL_MODE.QUALITY_SOAK
    : EVAL_MODE.SAFETY_CANARY;

/** Hard safety classes — always stop releasing new sessions. */
export const SAFETY_STOP_REASONS = Object.freeze([
  'UNSUPPORTED_CLAIM_ESCAPED',
  'PRIVACY_VIOLATION',
  'AUTHORIZATION_VIOLATION',
  'CROSS_USER_MEMORY_LEAKAGE',
  'EVIDENCE_LEDGER_CORRUPTION',
  'CLAIM_LEDGER_CORRUPTION',
  'SYNTHETIC_PRODUCTION_EVIDENCE',
  'PROTOCOL_INTEGRITY_FAILURE',
  'PERSISTENCE_INTEGRITY_FAILURE',
  'DUPLICATE_SESSION_ID',
  'DUAL_WRITER_INTEGRITY_FAILURE',
  'MODEL_TIMEOUT_EXHAUSTED',
  'UNEXPECTED_RULE_FALLBACK',
]);

/**
 * Decide whether a hard_failures entry should stop the run.
 * Contained invention-guard rejection stops only in SAFETY_CANARY.
 */
export function shouldStopOnFailure({ mode, failure } = {}) {
  const reason = String(failure?.reason || '');
  if (SAFETY_STOP_REASONS.includes(reason)) return true;
  if (reason === 'INVENTION_GUARD' || reason === 'MODEL_GUARD_REJECTED') {
    const escaped = Boolean(failure?.unsupported_claims_escaped);
    if (escaped) return true;
    if (mode === EVAL_MODE.QUALITY_SOAK) return false;
    return true;
  }
  return true;
}

export function emptyQualitySoakCounters() {
  return {
    guard_rejected_contained: 0,
    unsupported_claims_escaped: 0,
    verified_fallback_delivered: 0,
    fallback_failed: 0,
    customer_request_failed: 0,
    model_transport_failed: 0,
    model_timeout: 0,
    retrieval_failed: 0,
    claim_verification_failed: 0,
    // legacy aliases kept for existing callers
    model_generations_guard_rejected: 0,
    safe_fallback_success: 0,
    customer_request_failures: 0,
  };
}

export const MODEL_INVOCATION_LEDGER_SCHEMA = 'phase34-model-invocation-v1';

/**
 * Normalize an append-only model-attempt row with required provenance fields.
 */
export function buildModelInvocationRow(partial = {}) {
  const now = new Date().toISOString();
  return {
    schema_version: MODEL_INVOCATION_LEDGER_SCHEMA,
    run_id: partial.run_id ?? null,
    session_id: partial.session_id ?? null,
    turn_id: partial.turn_id ?? null,
    turn_index: partial.turn_index ?? null,
    inference_id: partial.inference_id ?? null,
    model_invocation_id: partial.model_invocation_id ?? null,
    parent_invocation_id: partial.parent_invocation_id ?? null,
    attempt_index: partial.attempt_index ?? partial.attempt ?? 0,
    capability: partial.capability ?? null,
    scenario_id: partial.scenario_id ?? null,
    scenario_class: partial.scenario_class ?? null,
    participant_scope: partial.participant_scope ?? null,
    model_provider: partial.model_provider ?? 'ollama',
    model_identifier: partial.model_identifier ?? null,
    model_digest: partial.model_digest ?? null,
    model_tier: partial.model_tier ?? 'TRANSPORT_AND_SMOKE_ONLY',
    prompt_configuration_id: partial.prompt_configuration_id ?? null,
    prompt_registry_hash: partial.prompt_registry_hash ?? null,
    system_prompt_hash: partial.system_prompt_hash ?? null,
    user_prompt_hash: partial.user_prompt_hash ?? null,
    full_sanitized_prompt_hash: partial.full_sanitized_prompt_hash ?? null,
    evidence_snapshot_id: partial.evidence_snapshot_id ?? null,
    evidence_snapshot_hash: partial.evidence_snapshot_hash ?? null,
    eligible_evidence_ids: partial.eligible_evidence_ids ?? null,
    claim_ledger_id: partial.claim_ledger_id ?? null,
    deterministic_calculation_ids: partial.deterministic_calculation_ids ?? null,
    memory_state_hash: partial.memory_state_hash ?? null,
    correction_state_hash: partial.correction_state_hash ?? null,
    retrieval_mode_requested: partial.retrieval_mode_requested ?? null,
    retrieval_mode_executed: partial.retrieval_mode_executed ?? null,
    retrieval_result_hash: partial.retrieval_result_hash ?? null,
    context_window_configured: partial.context_window_configured ?? null,
    context_tokens_used: partial.context_tokens_used ?? null,
    truncation_status: partial.truncation_status ?? null,
    input_token_count: partial.input_token_count ?? null,
    output_token_count: partial.output_token_count ?? null,
    temperature: partial.temperature ?? null,
    top_p: partial.top_p ?? null,
    seed: partial.seed ?? null,
    stop_configuration_hash: partial.stop_configuration_hash ?? null,
    queued_at: partial.queued_at ?? null,
    started_at: partial.started_at ?? null,
    first_token_at: partial.first_token_at ?? null,
    completed_at: partial.completed_at ?? now,
    queue_latency_us: partial.queue_latency_us ?? null,
    time_to_first_token_us: partial.time_to_first_token_us ?? null,
    generation_latency_us: partial.generation_latency_us ?? null,
    total_model_latency_us: partial.total_model_latency_us ?? null,
    raw_output_hash: partial.raw_output_hash ?? null,
    sanitized_output_hash: partial.sanitized_output_hash ?? null,
    parsed_material_claims: partial.parsed_material_claims ?? null,
    allowed_claim_values: partial.allowed_claim_values ?? null,
    guard_verdict: partial.guard_verdict ?? null,
    guard_violation_codes: partial.guard_violation_codes ?? null,
    customer_response_path: partial.customer_response_path ?? null,
    fallback_result: partial.fallback_result ?? partial.fallback ?? null,
    timeout_transport_status: partial.timeout_transport_status ?? null,
    outcome: partial.outcome ?? null,
    violations: partial.violations ?? null,
    model_ledger: partial.model_ledger ?? null,
    unsupported_claims_escaped: partial.unsupported_claims_escaped ?? null,
    accepted_response_hash: partial.accepted_response_hash ?? null,
    error: partial.error ?? null,
  };
}

/**
 * Attempt-level ledger invariant:
 * rows == successful + guard_rejected + timed_out + transport_failed + cancelled
 *
 * Turn-level coverage is checked separately; retries may make attempt rows > turns.
 */
export function assertInvocationLedgerInvariant({
  model_invocation_ledger_rows,
  model_invoked_turns,
  accepted_model_turns,
  guard_rejected_turns,
  timeout_turns,
  transport_failure_turns,
  successful_attempts,
  guard_rejected_attempts,
  timed_out_attempts,
  transport_failed_attempts,
  cancelled_attempts = 0,
} = {}) {
  const hasAttemptBreakdown =
    successful_attempts != null ||
    guard_rejected_attempts != null ||
    timed_out_attempts != null ||
    transport_failed_attempts != null;

  if (hasAttemptBreakdown) {
    const rhs =
      Number(successful_attempts || 0) +
      Number(guard_rejected_attempts || 0) +
      Number(timed_out_attempts || 0) +
      Number(transport_failed_attempts || 0) +
      Number(cancelled_attempts || 0);
    const rows = Number(model_invocation_ledger_rows || 0);
    const ok = rows === rhs;
    return {
      ok,
      level: 'attempt',
      violation_code: ok ? null : 'MODEL_INVOCATION_LEDGER_COVERAGE_FAILURE',
      model_invocation_ledger_rows: rows,
      rhs,
      successful_attempts: Number(successful_attempts || 0),
      guard_rejected_attempts: Number(guard_rejected_attempts || 0),
      timed_out_attempts: Number(timed_out_attempts || 0),
      transport_failed_attempts: Number(transport_failed_attempts || 0),
      cancelled_attempts: Number(cancelled_attempts || 0),
    };
  }

  const rhs =
    Number(accepted_model_turns || 0) +
    Number(guard_rejected_turns || 0) +
    Number(timeout_turns || 0) +
    Number(transport_failure_turns || 0);
  const rows = Number(model_invocation_ledger_rows || 0);
  const invoked = Number(model_invoked_turns || 0);
  const ok = rows === invoked && invoked === rhs;
  return {
    ok,
    level: 'turn_legacy',
    violation_code: ok ? null : 'MODEL_INVOCATION_LEDGER_COVERAGE_FAILURE',
    model_invocation_ledger_rows: rows,
    model_invoked_turns: invoked,
    accepted_model_turns: Number(accepted_model_turns || 0),
    guard_rejected_turns: Number(guard_rejected_turns || 0),
    timeout_turns: Number(timeout_turns || 0),
    transport_failure_turns: Number(transport_failure_turns || 0),
    rhs,
  };
}

export function assertTurnInvocationInvariant({
  model_invoked_turns,
  accepted_model_turns,
  guard_rejected_turns,
  timeout_turns,
  transport_failure_turns,
  cancelled_turns = 0,
} = {}) {
  const rhs =
    Number(accepted_model_turns || 0) +
    Number(guard_rejected_turns || 0) +
    Number(timeout_turns || 0) +
    Number(transport_failure_turns || 0) +
    Number(cancelled_turns || 0);
  const invoked = Number(model_invoked_turns || 0);
  const ok = invoked === rhs;
  return {
    ok,
    violation_code: ok ? null : 'MODEL_INVOCATION_LEDGER_COVERAGE_FAILURE',
    model_invoked_turns: invoked,
    rhs,
  };
}

/** Append-only model invocation ledger row (unbuffered). */
export function appendModelInvocationLedger(filePath, row) {
  const normalized = buildModelInvocationRow(row);
  fs.appendFileSync(filePath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

/**
 * Scan failure ledgers for true-invention / guard rejection without
 * double-counting a session row plus a failures.jsonl row as two sessions.
 */
export function scanInventionGuardFailures(failureRows = [], hardFailures = []) {
  const rows = [];
  for (const row of failureRows || []) {
    if (!row || typeof row !== 'object') continue;
    const reason = String(row.reason || row.failure_class || '');
    const status = String(row.status || row.session_outcome || '').toUpperCase();
    const hasInvention =
      reason === 'INVENTION_GUARD' ||
      reason === 'MODEL_GUARD_REJECTED' ||
      (Array.isArray(row.violations) &&
        row.violations.some((v) => v?.code === 'UNSUPPORTED_NUMERIC_VALUE'));
    const legacyFail =
      row.ok === false ||
      row.hard_failure === true ||
      status === 'FAIL' ||
      status === 'FAILED' ||
      status === 'BLOCKED';
    if (hasInvention || (legacyFail && Array.isArray(row.violations))) rows.push(row);
  }
  for (const hf of hardFailures || []) {
    if (!hf) continue;
    if (hf.reason === 'INVENTION_GUARD' || hf.reason === 'MODEL_GUARD_REJECTED') {
      rows.push(hf);
    }
  }

  const bySession = new Map();
  for (const row of rows) {
    const sid = row.session_id || row.session?.session_id;
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(row);
  }

  const unsupportedValues = [];
  let guardRejectedTurns = 0;
  let escaped = 0;
  for (const [, sessionRows] of bySession) {
    guardRejectedTurns += 1;
    for (const row of sessionRows) {
      if (row.unsupported_claims_escaped) escaped += 1;
      for (const v of Array.isArray(row.violations) ? row.violations : []) {
        if (v?.code === 'UNSUPPORTED_NUMERIC_VALUE' && v.claim?.value != null) {
          unsupportedValues.push(Number(v.claim.value));
        }
      }
    }
  }

  return {
    failed_session_count: bySession.size,
    guard_rejected_model_turns: guardRejectedTurns,
    reasons: [...new Set(rows.map((r) => r.reason).filter(Boolean))],
    unsupported_numeric_values: [...new Set(unsupportedValues)],
    unsupported_claims_escaped: escaped,
    violation_codes: [
      ...new Set(
        rows.flatMap((r) => (Array.isArray(r.violations) ? r.violations : [])).map((v) => v.code),
      ),
    ],
  };
}

/**
 * Recognize real Phase 34 failure JSONL schemas, including v3 reason/violations.
 */
export function isFailureLedgerRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.ok === false || row.success === false) return true;
  if (row.reason || row.error || row.error_class || row.failure_class || row.hard_failure) {
    return true;
  }
  if (Array.isArray(row.violations) && row.violations.length > 0) return true;
  const status = String(row.status || row.result || row.session_outcome || '').toUpperCase();
  if (
    ['FAIL', 'FAILED', 'BLOCKED', 'ERROR', 'TIMEOUT', 'MODEL_TIMEOUT_EXHAUSTED'].includes(status)
  ) {
    return true;
  }
  return false;
}

export function countFailureLedgerRows(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, rows: 0, state: 'INITIALIZED_NO_ROWS' };
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return { exists: true, rows: 0, state: 'INITIALIZED_NO_ROWS' };
  let rows = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (isFailureLedgerRow(row)) rows += 1;
    } catch {
      /* malformed counted elsewhere */
    }
  }
  return { exists: true, rows, state: 'HAS_ROWS' };
}
