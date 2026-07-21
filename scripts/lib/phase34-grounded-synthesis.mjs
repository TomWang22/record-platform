/**
 * Phase E4 — schema-validated grounded synthesis.
 * Tiers: deterministic-only, low-latency, high-quality, privacy-local.
 * Without a live model gateway, deterministic-only produces customer prose
 * from structured_result + evidence summary — no invented numbers.
 */
export const SYNTHESIS_VERSION = 'phase34-grounded-synthesis-v1';

export const SYNTHESIS_TIERS = Object.freeze([
  'deterministic-only',
  'low-latency',
  'high-quality',
  'privacy-local',
]);

export const REQUIRED_ANSWER_FIELDS = Object.freeze([
  'direct_answer',
  'customer_summary',
  'key_values',
  'what_changed',
  'evidence_summary',
  'limitations',
  'next_actions',
  'uncertainties',
  'confidence',
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, details);
  throw err;
}

/**
 * Validate synthesis input schema.
 */
export function validateSynthesisInput(input) {
  if (!isPlainObject(input)) {
    fail('SYNTHESIS_INPUT_INVALID', 'synthesis input must be an object');
  }
  if (!input.capability) {
    fail('SYNTHESIS_INPUT_MISSING_CAPABILITY', 'capability is required');
  }
  if (input.tier && !SYNTHESIS_TIERS.includes(input.tier)) {
    fail('SYNTHESIS_UNKNOWN_TIER', `unknown tier: ${input.tier}`);
  }
  if (input.structured_result != null && !isPlainObject(input.structured_result)) {
    fail('SYNTHESIS_STRUCTURED_RESULT_INVALID', 'structured_result must be an object');
  }
  return true;
}

/**
 * Validate synthesis output schema (required answer structure).
 */
export function validateSynthesisOutput(output) {
  if (!isPlainObject(output)) {
    fail('SYNTHESIS_OUTPUT_INVALID', 'synthesis output must be an object');
  }
  for (const field of REQUIRED_ANSWER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(output, field)) {
      fail('SYNTHESIS_OUTPUT_MISSING_FIELD', `missing required field: ${field}`, { field });
    }
  }
  if (typeof output.direct_answer !== 'string' || !output.direct_answer.trim()) {
    fail('SYNTHESIS_OUTPUT_EMPTY_ANSWER', 'direct_answer must be non-empty string');
  }
  if (typeof output.customer_summary !== 'string') {
    fail('SYNTHESIS_OUTPUT_BAD_SUMMARY', 'customer_summary must be a string');
  }
  if (!isPlainObject(output.key_values)) {
    fail('SYNTHESIS_OUTPUT_BAD_KEY_VALUES', 'key_values must be an object');
  }
  if (!Array.isArray(output.limitations)) {
    fail('SYNTHESIS_OUTPUT_BAD_LIMITATIONS', 'limitations must be an array');
  }
  if (!Array.isArray(output.next_actions)) {
    fail('SYNTHESIS_OUTPUT_BAD_NEXT_ACTIONS', 'next_actions must be an array');
  }
  if (!Array.isArray(output.uncertainties)) {
    fail('SYNTHESIS_OUTPUT_BAD_UNCERTAINTIES', 'uncertainties must be an array');
  }
  return true;
}

function formatValue(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  return null;
}

function pickKeyValues(structured = {}) {
  const keys = [
    'sold_count',
    'asking_count',
    'median',
    'sold_median',
    'price_median',
    'fair_low',
    'fair_high',
    'quick',
    'patient',
    'scarcity_label',
    'scarcity_score',
    'percentage_change',
    'percent_change',
    'currency',
    'sample_size',
    'completed_sale_sample_size',
  ];
  const out = {};
  for (const k of keys) {
    if (structured[k] != null && formatValue(structured[k]) != null) {
      out[k] = structured[k];
    }
  }
  // Nested common shapes
  if (isPlainObject(structured.metrics)) {
    for (const k of keys) {
      if (structured.metrics[k] != null && out[k] == null) out[k] = structured.metrics[k];
    }
  }
  return out;
}

function evidenceLine(snapshot, evidence_summary) {
  if (evidence_summary && typeof evidence_summary === 'string') return evidence_summary;
  if (evidence_summary && isPlainObject(evidence_summary)) {
    const included = evidence_summary.included ?? evidence_summary.included_count;
    const excluded = evidence_summary.excluded ?? evidence_summary.excluded_count;
    if (included != null) {
      return `Evidence snapshot includes ${included} eligible event(s)` +
        (excluded != null ? ` and excludes ${excluded}.` : '.');
    }
  }
  if (snapshot?.included_event_ids) {
    return `Evidence snapshot includes ${snapshot.included_event_ids.length} eligible event(s)` +
      (snapshot.excluded_event_ids
        ? ` and excludes ${snapshot.excluded_event_ids.length}.`
        : '.');
  }
  return 'No eligible evidence rows in the current snapshot.';
}

/**
 * Deterministic-only customer prose — only numbers from structured_result.
 */
export function synthesizeDeterministic(input = {}) {
  validateSynthesisInput(input);
  const structured = input.structured_result || {};
  const key_values = pickKeyValues(structured);
  const currency = key_values.currency || structured.currency || 'USD';
  const limitations = [
    ...(Array.isArray(input.limitations) ? input.limitations : []),
    ...(Array.isArray(structured.limitations) ? structured.limitations : []),
  ];
  const honestEmpty =
    (key_values.sold_count === 0 ||
      key_values.sample_size === 0 ||
      key_values.completed_sale_sample_size === 0 ||
      Object.keys(key_values).length === 0) &&
    (!snapshotHasIncluded(input.snapshot));

  let direct_answer;
  if (honestEmpty || input.honest_limit === true) {
    direct_answer =
      structured.conclusion ||
      structured.customer_summary ||
      'I do not have enough eligible evidence to answer this with grounded market figures.';
    if (!limitations.includes('INSUFFICIENT_EVIDENCE')) {
      limitations.push('INSUFFICIENT_EVIDENCE');
    }
  } else if (typeof structured.conclusion === 'string' && structured.conclusion.trim()) {
    direct_answer = structured.conclusion;
  } else if (typeof structured.customer_summary === 'string' && structured.customer_summary.trim()) {
    direct_answer = structured.customer_summary;
  } else {
    direct_answer = buildProseFromKeys(input.capability, key_values, currency);
  }

  const customer_summary =
    (typeof structured.customer_summary === 'string' && structured.customer_summary) ||
    direct_answer;

  const what_changed =
    structured.what_changed ??
    input.what_changed ??
    (Array.isArray(input.refinements) && input.refinements.length
      ? input.refinements.map((r) => `${r.field}: ${r.from} → ${r.to}`).join('; ')
      : '');

  const output = {
    synthesis_version: SYNTHESIS_VERSION,
    tier: 'deterministic-only',
    model_invoked: false,
    model_gateway: null,
    direct_answer,
    customer_summary,
    key_values,
    what_changed,
    evidence_summary: evidenceLine(input.snapshot, input.evidence_summary),
    limitations: [...new Set(limitations)],
    next_actions: Array.isArray(structured.next_actions)
      ? structured.next_actions
      : Array.isArray(input.next_actions)
        ? input.next_actions
        : [],
    uncertainties: Array.isArray(structured.uncertainties)
      ? structured.uncertainties
      : Array.isArray(input.uncertainties)
        ? input.uncertainties
        : honestEmpty
          ? ['Insufficient eligible evidence for numeric claims']
          : [],
    confidence: structured.confidence ?? input.confidence ?? (honestEmpty ? 'low' : 'medium'),
    structured_result: structured,
  };

  validateSynthesisOutput(output);
  return Object.freeze(output);
}

function snapshotHasIncluded(snapshot) {
  return Array.isArray(snapshot?.included_event_ids) && snapshot.included_event_ids.length > 0;
}

function buildProseFromKeys(capability, key_values, currency) {
  const parts = [];
  if (capability === 'valuation' && key_values.fair_low != null && key_values.fair_high != null) {
    parts.push(
      `Fair range is ${key_values.fair_low}–${key_values.fair_high} ${currency}` +
        (key_values.sold_count != null ? ` from ${key_values.sold_count} completed sale(s).` : '.'),
    );
  } else if (capability === 'scarcity' && key_values.scarcity_label) {
    parts.push(
      `Scarcity assessment: ${key_values.scarcity_label}` +
        (key_values.scarcity_score != null ? ` (score ${key_values.scarcity_score}).` : '.'),
    );
  } else if (capability === 'market_analytics') {
    const median = key_values.sold_median ?? key_values.price_median ?? key_values.median;
    if (median != null) {
      parts.push(`Completed-sale median is ${median} ${currency}`);
      if (key_values.sold_count != null) parts.push(`across ${key_values.sold_count} sales`);
      const pct = key_values.percentage_change ?? key_values.percent_change;
      if (pct != null) parts.push(`(${pct}% vs prior window)`);
      parts.push('.');
    }
  }
  if (!parts.length) {
    const entries = Object.entries(key_values).filter(([, v]) => v != null);
    if (entries.length) {
      parts.push(entries.map(([k, v]) => `${k}=${v}`).join(', ') + '.');
    } else {
      parts.push('Structured result has no numeric fields to summarize.');
    }
  }
  return parts.join(' ').replace(/\s+\./g, '.').replace(/\s+/g, ' ').trim();
}

/**
 * Model-tier synthesis. Without a gateway, falls back to deterministic-only
 * and records that the model was not invoked.
 */
export async function synthesizeGrounded(input = {}) {
  validateSynthesisInput(input);
  const tier = input.tier || 'deterministic-only';

  if (tier === 'deterministic-only') {
    return synthesizeDeterministic(input);
  }

  const gateway = input.modelGateway || input.model_gateway || null;
  if (!gateway || typeof gateway.complete !== 'function') {
    const det = synthesizeDeterministic({
      ...input,
      limitations: [
        ...(input.limitations || []),
        `MODEL_GATEWAY_UNAVAILABLE_FOR_TIER:${tier}`,
      ],
    });
    return Object.freeze({
      ...det,
      tier,
      model_invoked: false,
      model_gateway: null,
      fallback_tier: 'deterministic-only',
    });
  }

  const modelOut = await gateway.complete({
    tier,
    capability: input.capability,
    structured_result: input.structured_result,
    snapshot: input.snapshot,
    evidence_summary: input.evidence_summary,
    privacy_local: tier === 'privacy-local',
  });

  const merged = {
    synthesis_version: SYNTHESIS_VERSION,
    tier,
    model_invoked: true,
    model_gateway: gateway.name || 'custom',
    direct_answer: modelOut.direct_answer || modelOut.answer || '',
    customer_summary: modelOut.customer_summary || modelOut.direct_answer || '',
    key_values: modelOut.key_values || pickKeyValues(input.structured_result || {}),
    what_changed: modelOut.what_changed ?? input.what_changed ?? '',
    evidence_summary: modelOut.evidence_summary || evidenceLine(input.snapshot, input.evidence_summary),
    limitations: modelOut.limitations || input.limitations || [],
    next_actions: modelOut.next_actions || [],
    uncertainties: modelOut.uncertainties || [],
    confidence: modelOut.confidence ?? 'medium',
    structured_result: input.structured_result || {},
  };
  validateSynthesisOutput(merged);
  return Object.freeze(merged);
}

export default synthesizeGrounded;
