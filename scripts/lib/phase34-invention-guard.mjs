/**
 * Phase E5 — invention guard (v2 typed claims).
 * Extract numeric/factual claims; compare to typed supported claims + claim ledger.
 * Being inside a fair range does NOT authorize inventing a recommended price.
 */
import { synthesizeDeterministic } from './phase34-grounded-synthesis.mjs';
import {
  buildTypedSupportedClaims,
  inferClaimType,
  isTypedClaimSupported,
  CLAIM_TYPES,
} from './phase34-typed-claims.mjs';

export const INVENTION_GUARD_VERSION = 'phase34-invention-guard-v2-typed';

const CURRENCY_RE = /\b(USD|EUR|GBP|CAD|AUD|JPY)\b/gi;
const MONEY_RE = /(?:\$|€|£)\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP)\b/gi;
const NUMBER_RE = /\$?\d+(?:\.\d+)?%?/g;
const EXACT_PRESSING_RE = /\bexact(?:ly)?\s+pressing\b|\bthis\s+specific\s+pressing\b/gi;

function asArray(v) {
  return Array.isArray(v) ? v : [];
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
    if (claims.some((c) => c.index <= m.index && m.index < c.index + c.raw.length)) continue;
    const bare = raw.replace(/[^\d.]/g, '');
    if (!bare) continue;
    const num = Number(bare);
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
 * Guard a synthesized answer against typed structured truth.
 */
export function guardInvention({
  text = '',
  structured_result = {},
  claim_ledger = null,
  snapshot = null,
  subject_resolution = null,
  constraints = {},
  calc_values = [],
  use_typed_claims = true,
} = {}) {
  const claims = extractClaims(text);
  const supported = buildTypedSupportedClaims(structured_result, claim_ledger);
  for (const v of calc_values) {
    if (typeof v === 'number' && Number.isFinite(v) && !supported.money_usd.includes(v)) {
      supported.money_usd.push(v);
    }
  }
  const allowedCurrencies = collectAllowedCurrencies(structured_result, constraints);
  const excludedIds = new Set(
    asArray(snapshot?.excluded_event_ids)
      .map((x) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean),
  );
  const violations = [];

  const resolution = subject_resolution || snapshot?.subject_resolution || {};
  const releaseOnly =
    resolution.match_status === 'MATCHED_RELEASE_ONLY' ||
    resolution.identity_status === 'RELEASE_LEVEL_ONLY' ||
    resolution.pressing_confidence === 'RELEASE_LEVEL_MATCH';

  for (const claim of claims) {
    if (claim.kind === 'money' || claim.kind === 'number' || claim.kind === 'percent') {
      const claimType = use_typed_claims
        ? inferClaimType(text, claim)
        : claim.kind === 'money'
          ? CLAIM_TYPES.MONEY_GENERIC
          : CLAIM_TYPES.COUNT_GENERIC;
      const ok = isTypedClaimSupported(claimType, claim.value, supported);
      if (!ok && Number.isFinite(claim.value)) {
        violations.push({
          code: 'UNSUPPORTED_NUMERIC_VALUE',
          claim: { ...claim, claim_type: claimType },
          message: `unsupported value ${claim.raw} as ${claimType}`,
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

  for (const id of excludedIds) {
    if (id && text.includes(id)) {
      violations.push({
        code: 'EXCLUDED_EVENT_CITED',
        claim: { kind: 'excluded_event', raw: id },
        message: `excluded event ${id} cited in answer`,
      });
    }
  }

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
    supported_claims: supported,
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
    claim_ledger: null,
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
