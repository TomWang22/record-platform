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
    unsupported_claims_escaped: 0,
    model_generations_guard_rejected: 0,
    safe_fallback_success: 0,
    customer_request_failures: 0,
  };
}

/**
 * Invocation ledger invariant:
 * rows == invoked == accepted + guard_rejected + timeout + transport_failure
 */
export function assertInvocationLedgerInvariant({
  model_invocation_ledger_rows,
  model_invoked_turns,
  accepted_model_turns,
  guard_rejected_turns,
  timeout_turns,
  transport_failure_turns,
} = {}) {
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
    model_invocation_ledger_rows: rows,
    model_invoked_turns: invoked,
    accepted_model_turns: Number(accepted_model_turns || 0),
    guard_rejected_turns: Number(guard_rejected_turns || 0),
    timeout_turns: Number(timeout_turns || 0),
    transport_failure_turns: Number(transport_failure_turns || 0),
    rhs,
  };
}

/** Append-only model invocation ledger row (unbuffered). */
export function appendModelInvocationLedger(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
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
