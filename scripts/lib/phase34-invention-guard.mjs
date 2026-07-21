/**
 * Phase E5 — invention guard.
 * Extract numeric/factual claims; compare to structured result + claim ledger.
 * Reject unsupported values, wrong currency, exact-pressing from release-only,
 * excluded events. Retry-once hook + fallback to deterministic prose.
 */
import { synthesizeDeterministic } from './phase34-grounded-synthesis.mjs';

export const INVENTION_GUARD_VERSION = 'phase34-invention-guard-v1';

const CURRENCY_RE = /\b(USD|EUR|GBP|CAD|AUD|JPY)\b/gi;
const MONEY_RE = /(?:\$|€|£)\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP)\b/gi;
const NUMBER_RE = /\$?\d+(?:\.\d+)?%?/g;
const EXACT_PRESSING_RE = /\bexact(?:ly)?\s+pressing\b|\bthis\s+specific\s+pressing\b/gi;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function collectAllowedNumbers(structured = {}, ledger = null, calcValues = []) {
  const allowed = new Set();
  const add = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      allowed.add(String(v));
      allowed.add(String(Math.round(v * 100) / 100));
    }
  };
  const walk = (obj, depth = 0) => {
    if (obj == null || depth > 4) return;
    if (typeof obj === 'number') {
      add(obj);
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
      return;
    }
    if (typeof obj === 'object') {
      for (const v of Object.values(obj)) walk(v, depth + 1);
    }
  };
  walk(structured);
  for (const v of calcValues) add(v);
  for (const entry of asArray(ledger?.entries)) {
    if (entry.normalized_claim_value != null) add(Number(entry.normalized_claim_value));
  }
  return allowed;
}

function collectAllowedCurrencies(structured = {}, constraints = {}) {
  const set = new Set();
  if (constraints.currency) set.add(String(constraints.currency).toUpperCase());
  if (structured.currency) set.add(String(structured.currency).toUpperCase());
  if (structured.key_values?.currency) set.add(String(structured.key_values.currency).toUpperCase());
  return set;
}

function extractClaims(text) {
  const s = String(text || '');
  const claims = [];

  for (const m of s.matchAll(MONEY_RE)) {
    const raw = m[0];
    const num = Number(String(raw).replace(/[^\d.]/g, ''));
    let currency = 'USD';
    if (raw.includes('€') || /EUR/i.test(raw)) currency = 'EUR';
    else if (raw.includes('£') || /GBP/i.test(raw)) currency = 'GBP';
    else if (/USD/i.test(raw)) currency = 'USD';
    claims.push({
      kind: 'money',
      raw,
      value: num,
      currency,
      index: m.index,
    });
  }

  for (const m of s.matchAll(NUMBER_RE)) {
    const raw = m[0];
    // Skip if already captured as money span
    if (claims.some((c) => c.index <= m.index && m.index < c.index + c.raw.length)) continue;
    const bare = raw.replace(/[^\d.]/g, '');
    if (!bare) continue;
    const num = Number(bare);
    // Ignore tiny structural numbers unless percent/currency-like
    if (!raw.includes('$') && !raw.includes('%') && num < 3) continue;
    claims.push({
      kind: raw.includes('%') ? 'percent' : 'number',
      raw,
      value: num,
      currency: null,
      index: m.index,
    });
  }

  for (const m of s.matchAll(CURRENCY_RE)) {
    claims.push({
      kind: 'currency_token',
      raw: m[0].toUpperCase(),
      value: null,
      currency: m[0].toUpperCase(),
      index: m.index,
    });
  }

  for (const m of s.matchAll(EXACT_PRESSING_RE)) {
    claims.push({
      kind: 'exact_pressing_assertion',
      raw: m[0],
      value: null,
      currency: null,
      index: m.index,
    });
  }

  return claims;
}

/**
 * Guard a synthesized answer against structured truth.
 *
 * @returns {{ ok: boolean, violations: array, claims: array, guarded_text: string }}
 */
export function guardInvention({
  text = '',
  structured_result = {},
  claim_ledger = null,
  snapshot = null,
  subject_resolution = null,
  constraints = {},
  calc_values = [],
} = {}) {
  const claims = extractClaims(text);
  const allowedNums = collectAllowedNumbers(structured_result, claim_ledger, calc_values);
  const allowedCurrencies = collectAllowedCurrencies(structured_result, constraints);
  const excludedIds = new Set(
    asArray(snapshot?.excluded_event_ids).map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean),
  );
  const violations = [];

  const resolution = subject_resolution || snapshot?.subject_resolution || {};
  const releaseOnly =
    resolution.match_status === 'MATCHED_RELEASE_ONLY' ||
    resolution.identity_status === 'RELEASE_LEVEL_ONLY' ||
    resolution.pressing_confidence === 'RELEASE_LEVEL_MATCH';

  for (const claim of claims) {
    if (claim.kind === 'money' || claim.kind === 'number' || claim.kind === 'percent') {
      const bare = String(claim.value);
      const ok =
        allowedNums.has(bare) ||
        allowedNums.has(String(Math.round(claim.value * 100) / 100)) ||
        // Allow counts that match sold_count etc. already walked
        [...allowedNums].some((a) => a === bare);
      if (!ok && Number.isFinite(claim.value)) {
        // Empty allowed set + honest "no evidence" prose with no numbers is fine;
        // any number not in structured result is invention.
        violations.push({
          code: 'UNSUPPORTED_NUMERIC_VALUE',
          claim,
          message: `unsupported value ${claim.raw}`,
        });
      }
    }

    if (claim.kind === 'money' || claim.kind === 'currency_token') {
      if (
        claim.currency &&
        allowedCurrencies.size > 0 &&
        !allowedCurrencies.has(claim.currency)
      ) {
        violations.push({
          code: 'WRONG_CURRENCY',
          claim,
          message: `currency ${claim.currency} not in allowed set`,
        });
      }
    }

    if (claim.kind === 'exact_pressing_assertion' && releaseOnly) {
      violations.push({
        code: 'EXACT_PRESSING_FROM_RELEASE_ONLY',
        claim,
        message: 'exact-pressing claim not allowed under RELEASE_ONLY resolution',
      });
    }
  }

  // Excluded event IDs must not appear as supporting citations in prose.
  for (const id of excludedIds) {
    if (id && text.includes(id)) {
      violations.push({
        code: 'EXCLUDED_EVENT_CITED',
        claim: { kind: 'excluded_event', raw: id },
        message: `excluded event ${id} cited in answer`,
      });
    }
  }

  // Failed ledger blocks delivery.
  if (claim_ledger && claim_ledger.verification_status === 'FAIL') {
    violations.push({
      code: 'CLAIM_LEDGER_FAIL',
      claim: null,
      message: 'claim ledger verification_status is FAIL',
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    claims,
    guarded_text: text,
    invention_guard_version: INVENTION_GUARD_VERSION,
  };
}

export function assertInventionGuardPass(result) {
  if (!result?.ok) {
    const err = new Error('INVENTION_GUARD_REJECTED');
    err.code = 'INVENTION_GUARD_REJECTED';
    err.violations = result?.violations || [];
    throw err;
  }
  return result;
}

/**
 * Guard with retry-once hook, then deterministic prose fallback.
 */
export async function guardWithRetry({
  text,
  structured_result,
  claim_ledger,
  snapshot,
  subject_resolution,
  constraints,
  calc_values,
  retryOnce = null,
  synthesisInput = null,
} = {}) {
  let attempt = guardInvention({
    text,
    structured_result,
    claim_ledger,
    snapshot,
    subject_resolution,
    constraints,
    calc_values,
  });

  if (attempt.ok) {
    return { ...attempt, attempts: 1, used_fallback: false };
  }

  if (typeof retryOnce === 'function') {
    const retriedText = await retryOnce({
      previous_text: text,
      violations: attempt.violations,
      structured_result,
    });
    attempt = guardInvention({
      text: retriedText,
      structured_result,
      claim_ledger,
      snapshot,
      subject_resolution,
      constraints,
      calc_values,
    });
    if (attempt.ok) {
      return { ...attempt, attempts: 2, used_fallback: false };
    }
  }

  // Fail closed → deterministic prose from structured result only.
  const det = synthesizeDeterministic({
    ...(synthesisInput || {}),
    capability: synthesisInput?.capability || 'market_analytics',
    structured_result,
    snapshot,
    limitations: [
      ...(synthesisInput?.limitations || []),
      'INVENTION_GUARD_FALLBACK_DETERMINISTIC',
    ],
    honest_limit: synthesisInput?.honest_limit,
  });

  const fallbackGuard = guardInvention({
    text: det.direct_answer,
    structured_result,
    claim_ledger: null, // deterministic path; ledger rebuilt by pipeline
    snapshot,
    subject_resolution,
    constraints,
    calc_values,
  });

  return {
    ...fallbackGuard,
    ok: fallbackGuard.ok,
    attempts: typeof retryOnce === 'function' ? 2 : 1,
    used_fallback: true,
    fallback_synthesis: det,
    prior_violations: attempt.violations,
  };
}

export default guardInvention;
