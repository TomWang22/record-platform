/**
 * Phase 34 source-verification telemetry — honest latency attribution and spans.
 * Never fabricate zero-duration measurements.
 */
import crypto from 'node:crypto';

export const TELEMETRY_VERSION = 'phase34-source-verification-telemetry-v1';

export const MEASUREMENT_STATUS = Object.freeze({
  INSTRUMENTED: 'INSTRUMENTED',
  PARTIAL_INSTRUMENTED: 'PARTIAL_INSTRUMENTED',
  NOT_INSTRUMENTED: 'NOT_INSTRUMENTED',
  NOT_INVOKED_BY_POLICY: 'NOT_INVOKED_BY_POLICY',
  NOT_ESTIMABLE: 'NOT_ESTIMABLE',
});

export const REQUIRED_SPAN_NAMES = Object.freeze([
  'browser.input',
  'browser.action',
  'gateway.request',
  'authorization.check',
  'thread.load',
  'context.load',
  'context.correct',
  'context.summarize',
  'evidence.snapshot.load',
  'evidence.assemble',
  'engine.execute',
  'identity.resolve',
  'analytics.compute',
  'embedding.compute',
  'retrieval.search',
  'reranker.rank',
  'tool.invoke',
  'model.queue',
  'model.request',
  'model.first_token',
  'model.generate',
  'schema.validate',
  'grounding.validate',
  'safety.validate',
  'privacy.validate',
  'gateway.response',
  'browser.render',
  'browser.terminal_ready',
  'screenshot.capture',
  'accessibility.check',
  'pcap.correlate',
]);

/** Stages that must be INSTRUMENTED (or accepted PARTIAL) when a customer turn executes. */
export const REQUIRED_EXECUTED_CUSTOMER_STAGES = Object.freeze([
  'browser.action',
  'gateway.request',
  'authorization.check',
  'context.load',
  'context.correct',
  'evidence.snapshot.load',
  'evidence.assemble',
  'engine.execute',
  'schema.validate',
  'grounding.validate',
  'safety.validate',
  'privacy.validate',
  'gateway.response',
  'browser.render',
  'browser.terminal_ready',
]);

export const CUSTOMER_LATENCY_FIELD = 'browser_action_to_terminal_ready_us';

/** @param {number|null|undefined} valueUs */
export function timingField(valueUs, opts = {}) {
  const status =
    opts.measurement_status ||
    (valueUs == null
      ? MEASUREMENT_STATUS.NOT_INSTRUMENTED
      : MEASUREMENT_STATUS.INSTRUMENTED);
  return {
    value_us: valueUs == null ? null : Math.round(valueUs),
    measurement_status: status,
    clock_source: opts.clock_source || (valueUs == null ? null : 'performance.now+Date'),
    started_at: opts.started_at || null,
    finished_at: opts.finished_at || null,
  };
}

export function emptyCustomerAndProtocolTimings() {
  const ni = () => timingField(null);
  return {
    browser_navigation_us: ni(),
    browser_input_us: ni(),
    browser_action_to_request_us: ni(),
    browser_request_to_response_us: ni(),
    browser_response_to_terminal_ready_us: ni(),
    browser_action_to_terminal_ready_us: ni(),
    browser_render_us: ni(),
    browser_screenshot_us: ni(),
    browser_accessibility_us: ni(),
    h1_total_us: ni(),
    h2_total_us: ni(),
    h3_total_us: ni(),
    triplet_start_spread_us: ni(),
    triplet_completion_spread_us: ni(),
    protocol_verification_total_us: ni(),
    source_verifier_orchestration_us: ni(),
    artifact_write_us: ni(),
    pcap_correlation_us: timingField(null, {
      measurement_status: MEASUREMENT_STATUS.NOT_INVOKED_BY_POLICY,
    }),
    total_source_verification_wall_us: ni(),
  };
}

export function classifyCustomerLatency(valueUs) {
  if (valueUs == null) {
    return { class: 'UNKNOWN', measurement_status: MEASUREMENT_STATUS.NOT_INSTRUMENTED };
  }
  const sec = valueUs / 1_000_000;
  if (sec <= 5) return { class: 'GOOD', measurement_status: MEASUREMENT_STATUS.INSTRUMENTED };
  if (sec <= 12) return { class: 'DEGRADED', measurement_status: MEASUREMENT_STATUS.INSTRUMENTED };
  if (sec <= 20) return { class: 'POOR', measurement_status: MEASUREMENT_STATUS.INSTRUMENTED };
  return { class: 'BLOCKING', measurement_status: MEASUREMENT_STATUS.INSTRUMENTED };
}

export function classifyLatencyOutlier(valueUs) {
  if (valueUs == null) return 'UNATTRIBUTED';
  const sec = valueUs / 1_000_000;
  if (sec > 12) return 'BLOCKING_OUTLIER';
  if (sec > 5) return 'DEGRADED';
  return 'WITHIN_POLICY';
}

export function buildSlowestTurnAttribution(turnRows = [], limit = 5) {
  const ranked = [...turnRows]
    .map((t) => {
      const customer =
        t.timings?.browser_action_to_terminal_ready_us?.value_us ??
        t.customer_latency_us ??
        null;
      const actionToRequest =
        t.timings?.browser_action_to_request_us?.value_us ?? null;
      const requestToResponse =
        t.timings?.browser_request_to_response_us?.value_us ?? null;
      const responseToReady =
        t.timings?.browser_response_to_terminal_ready_us?.value_us ?? null;
      const attributed =
        (actionToRequest || 0) + (requestToResponse || 0) + (responseToReady || 0);
      const unattributed =
        customer != null ? Math.max(0, customer - attributed) : null;
      const unattributed_ratio =
        customer && customer > 0 && unattributed != null ? unattributed / customer : null;
      let class_label = 'UNATTRIBUTED';
      if (requestToResponse != null && requestToResponse / Math.max(customer || 1, 1) > 0.5) {
        class_label = 'SERVICE_LATENCY';
      } else if (responseToReady != null && responseToReady / Math.max(customer || 1, 1) > 0.4) {
        class_label = 'BROWSER_READINESS_LATENCY';
      } else if (actionToRequest != null && actionToRequest / Math.max(customer || 1, 1) > 0.4) {
        class_label = 'ORCHESTRATION_OVERHEAD';
      } else if (customer != null && customer / 1e6 > 5) {
        class_label = 'EXPECTED_HEAVY_PIPELINE';
      }
      return {
        scenario_id: t.scenario_id,
        capability: t.capability,
        turn_index: t.turn_index,
        browser_action_to_request_us: actionToRequest,
        browser_request_to_response_us: requestToResponse,
        browser_response_to_terminal_ready_us: responseToReady,
        browser_action_to_terminal_ready_us: customer,
        gateway_us: requestToResponse,
        authorization_us: null,
        context_us: null,
        evidence_assembly_us: null,
        retrieval_us: null,
        model_us: null,
        validation_us: null,
        render_us: responseToReady,
        unattributed_us: unattributed,
        unattributed_ratio,
        class: class_label,
        customer_class: classifyCustomerLatency(customer),
      };
    })
    .filter((t) => t.browser_action_to_terminal_ready_us != null)
    .sort(
      (a, b) =>
        (b.browser_action_to_terminal_ready_us || 0) -
        (a.browser_action_to_terminal_ready_us || 0),
    );
  return ranked.slice(0, limit);
}

export function assertExecutedStageInstrumentation(spans = [], required = REQUIRED_EXECUTED_CUSTOMER_STAGES) {
  const byName = new Map(spans.map((s) => [s.name, s]));
  const gaps = [];
  const accepted_partial = [];
  for (const name of required) {
    const s = byName.get(name);
    const status = s?.measurement_status || MEASUREMENT_STATUS.NOT_INSTRUMENTED;
    if (status === MEASUREMENT_STATUS.NOT_INSTRUMENTED) {
      gaps.push({
        stage: name,
        measurement_status: status,
        exemption_reason: null,
      });
    } else if (status === MEASUREMENT_STATUS.NOT_INVOKED_BY_POLICY && s?.invocation_status === 'EXECUTED') {
      gaps.push({
        stage: name,
        measurement_status: status,
        exemption_reason: 'executed_marked_not_invoked',
      });
    } else if (status === MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED) {
      accepted_partial.push({
        stage: name,
        measurement_status: status,
        exemption_reason: s?.exemption_reason || 'partial_timing_fields_missing',
      });
    }
  }
  return {
    ok: gaps.length === 0,
    gaps,
    accepted_partial,
    required: required.length,
  };
}

export function newTraceId() {
  return `tr-${crypto.randomUUID()}`;
}

export function newSpanId() {
  return `sp-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Create a span record. Pass duration_us null → NOT_INSTRUMENTED unless status override.
 */
export function makeSpan({
  name,
  trace_id,
  parent_span_id = null,
  session_id = null,
  thread_id = null,
  turn_id = null,
  turn_index = null,
  capability = null,
  protocol = null,
  stage = null,
  started_at = null,
  finished_at = null,
  duration_us = null,
  measurement_status = null,
  invocation_status = null,
  error_class = null,
  input_hash = null,
  output_hash = null,
} = {}) {
  let status = measurement_status;
  if (!status) {
    status =
      duration_us == null
        ? MEASUREMENT_STATUS.NOT_INSTRUMENTED
        : MEASUREMENT_STATUS.INSTRUMENTED;
  }
  let inv = invocation_status;
  if (!inv) {
    inv =
      status === MEASUREMENT_STATUS.NOT_INVOKED_BY_POLICY
        ? 'NOT_INVOKED_BY_POLICY'
        : status === MEASUREMENT_STATUS.NOT_INSTRUMENTED
          ? 'UNKNOWN'
          : 'EXECUTED';
  }
  return {
    name,
    trace_id,
    span_id: newSpanId(),
    parent_span_id,
    session_id,
    thread_id,
    turn_id,
    turn_index,
    capability,
    protocol,
    stage: stage || name,
    started_at,
    finished_at,
    duration_us: duration_us == null ? null : Math.round(duration_us),
    measurement_status: status,
    invocation_status: inv,
    error_class,
    input_hash,
    output_hash,
  };
}

export function spanSetForTurn(meta = {}) {
  const spans = [];
  for (const name of REQUIRED_SPAN_NAMES) {
    const policyOnly = [
      'model.queue',
      'model.request',
      'model.first_token',
      'model.generate',
      'embedding.compute',
      'retrieval.search',
      'reranker.rank',
      'tool.invoke',
      'pcap.correlate',
    ].includes(name);
    spans.push(
      makeSpan({
        name,
        trace_id: meta.trace_id,
        parent_span_id: meta.parent_span_id || null,
        session_id: meta.session_id,
        thread_id: meta.thread_id,
        turn_id: meta.turn_id,
        turn_index: meta.turn_index,
        capability: meta.capability,
        protocol: meta.protocol,
        measurement_status: policyOnly
          ? MEASUREMENT_STATUS.NOT_INVOKED_BY_POLICY
          : MEASUREMENT_STATUS.NOT_INSTRUMENTED,
        invocation_status: policyOnly ? 'NOT_INVOKED_BY_POLICY' : 'UNKNOWN',
      }),
    );
  }
  return spans;
}

/** Patch spans by name with instrumented durations. */
export function instrumentSpans(spans, updates = {}) {
  return spans.map((s) => {
    const u = updates[s.name];
    if (!u) return s;
    return {
      ...s,
      ...u,
      duration_us: u.duration_us == null ? null : Math.round(u.duration_us),
      measurement_status: u.measurement_status || MEASUREMENT_STATUS.INSTRUMENTED,
      invocation_status: u.invocation_status || 'EXECUTED',
    };
  });
}

export function emptyTokenContextLedger() {
  return {
    context_tier: null,
    context_budget_tokens: null,
    context_used_tokens: null,
    current_request_tokens: null,
    recent_message_tokens: null,
    structured_fact_tokens: null,
    correction_tokens: null,
    summary_tokens: null,
    retrieval_tokens: null,
    tool_input_tokens: null,
    model_input_tokens: null,
    model_output_tokens: null,
    truncated_tokens: null,
    context_truncated: false,
    truncation_reason: null,
    measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
  };
}

export function estimateTokens(text) {
  const s = String(text || '');
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

export function factLedger({ before = {}, after = {}, intent = '' } = {}) {
  const facts_before = { ...before };
  const facts_after = { ...after };
  const facts_added = {};
  const facts_corrected = {};
  const facts_replaced = {};
  const facts_retained = {};
  const facts_excluded = [];
  for (const [k, v] of Object.entries(facts_after)) {
    if (!(k in facts_before)) facts_added[k] = v;
    else if (facts_before[k] !== v) {
      facts_corrected[k] = { previous: facts_before[k], updated: v };
      facts_replaced[k] = { previous: facts_before[k], updated: v };
    } else facts_retained[k] = v;
  }
  for (const [k, v] of Object.entries(facts_before)) {
    if (!(k in facts_after)) facts_excluded.push({ key: k, value: v, reason: 'dropped' });
  }
  return {
    intent,
    facts_before,
    facts_added,
    facts_corrected,
    facts_replaced,
    facts_retained,
    facts_excluded,
    facts_after,
  };
}

/**
 * Nearest-rank exact percentiles.
 * For small n: p99.9 → NOT_ESTIMABLE; p100 = exact max.
 */
export function nearestRankPercentiles(valuesUs = []) {
  const vals = valuesUs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const n = vals.length;
  const out = {
    n,
    p50: null,
    p90: null,
    p95: null,
    p99: null,
    p99_9: null,
    p100: null,
    p99_status: MEASUREMENT_STATUS.NOT_ESTIMABLE,
    p99_9_status: MEASUREMENT_STATUS.NOT_ESTIMABLE,
  };
  if (!n) return out;
  const rank = (p) => vals[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
  out.p50 = rank(50);
  out.p90 = rank(90);
  out.p95 = rank(95);
  out.p100 = vals[n - 1];
  if (n >= 100) {
    out.p99 = rank(99);
    out.p99_status = MEASUREMENT_STATUS.INSTRUMENTED;
  } else if (n >= 20) {
    out.p99 = rank(99);
    out.p99_status = 'LOW_SAMPLE';
  }
  // p99.9 not estimable for typical source-preflight sample sizes
  out.p99_9 = null;
  out.p99_9_status = MEASUREMENT_STATUS.NOT_ESTIMABLE;
  return out;
}

export function pipelineStageCompleteness(spans = []) {
  const byName = new Map(spans.map((s) => [s.name, s]));
  const rows = REQUIRED_SPAN_NAMES.map((name) => {
    const s = byName.get(name);
    return {
      name,
      measurement_status: s?.measurement_status || MEASUREMENT_STATUS.NOT_INSTRUMENTED,
      duration_us: s?.duration_us ?? null,
    };
  });
  const instrumented = rows.filter((r) => r.measurement_status === MEASUREMENT_STATUS.INSTRUMENTED)
    .length;
  const partial = rows.filter(
    (r) => r.measurement_status === MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
  ).length;
  const policy = rows.filter(
    (r) => r.measurement_status === MEASUREMENT_STATUS.NOT_INVOKED_BY_POLICY,
  ).length;
  return {
    required: REQUIRED_SPAN_NAMES.length,
    instrumented,
    partial_instrumented: partial,
    not_invoked_by_policy: policy,
    not_instrumented: REQUIRED_SPAN_NAMES.length - instrumented - partial - policy,
    completeness_ratio: (instrumented + partial) / REQUIRED_SPAN_NAMES.length,
    duration_instrumented_ratio: instrumented / REQUIRED_SPAN_NAMES.length,
    rows,
  };
}

export class Stopwatch {
  constructor() {
    this.t0 = performance.now();
    this.marks = new Map();
  }
  mark(name) {
    this.marks.set(name, { at: performance.now(), iso: new Date().toISOString() });
  }
  /** microseconds between two marks or from start */
  us(from, to) {
    const a = from == null ? this.t0 : this.marks.get(from)?.at;
    const b = to == null ? performance.now() : this.marks.get(to)?.at;
    if (a == null || b == null) return null;
    return (b - a) * 1000;
  }
  iso(name) {
    return this.marks.get(name)?.iso || null;
  }
  wallUs() {
    return (performance.now() - this.t0) * 1000;
  }
}
