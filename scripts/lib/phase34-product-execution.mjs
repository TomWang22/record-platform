/**
 * Execution pins, fail-closed, capacity plan, latency invariants, human-review import.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const EXECUTION_PIN_FIELDS = Object.freeze([
  'prompt_configuration_id',
  'prompt_hash',
  'system_prompt_hash',
  'model_tier',
  'model_identifier',
  'model_configuration_hash',
  'retrieval_mode_requested',
  'retrieval_mode_executed',
  'retrieval_configuration_hash',
  'reranker_version',
  'tool_configuration_hash',
  'embedding_version',
  'schema_version',
  'runtime_image_pin',
  'certificate_pin',
]);

/**
 * Pin configuration BEFORE invocation. Values must not be derived from response labels alone.
 */
export function pinExecutionConfig(partial = {}) {
  const pins = {
    prompt_configuration_id: partial.prompt_configuration_id ?? null,
    prompt_hash: partial.prompt_hash ?? null,
    system_prompt_hash: partial.system_prompt_hash ?? null,
    model_tier: partial.model_tier ?? null,
    model_identifier: partial.model_identifier ?? null,
    model_configuration_hash: partial.model_configuration_hash ?? null,
    retrieval_mode_requested: partial.retrieval_mode_requested ?? null,
    retrieval_mode_executed: partial.retrieval_mode_executed ?? null,
    retrieval_configuration_hash: partial.retrieval_configuration_hash ?? null,
    reranker_version: partial.reranker_version ?? null,
    tool_configuration_hash: partial.tool_configuration_hash ?? null,
    embedding_version: partial.embedding_version ?? null,
    schema_version: partial.schema_version ?? 'phase34-intelligence-v1',
    runtime_image_pin: partial.runtime_image_pin ?? null,
    certificate_pin: partial.certificate_pin ?? null,
    pinned_at: new Date().toISOString(),
  };
  const missing = EXECUTION_PIN_FIELDS.filter((f) => pins[f] == null || pins[f] === '');
  pins.pin_status = missing.length === 0 ? 'COMPLETE' : 'INCOMPLETE';
  pins.missing = missing;
  pins.pin_set_hash = crypto.createHash('sha256').update(JSON.stringify(pins)).digest('hex');
  return pins;
}

export function buildInvocationLedgerEntries({ session_id, turn_id, pins, timings = {} }) {
  const components = [
    'evidence_assembler',
    'embedding',
    'retrieval',
    'reranker',
    'deterministic_engine',
    'model',
    'tool',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ];
  return components.map((component) => ({
    invocation_id: `inv_${crypto.createHash('sha256').update(`${session_id}|${turn_id}|${component}`).digest('hex').slice(0, 16)}`,
    session_id,
    turn_id,
    component,
    version: pins?.[`_${component}_version`] || pins?.embedding_version || null,
    configuration_hash:
      pins?.retrieval_configuration_hash ||
      pins?.model_configuration_hash ||
      pins?.pin_set_hash ||
      null,
    started_at: timings[`${component}_started_at`] || null,
    finished_at: timings[`${component}_finished_at`] || null,
    duration_us: timings[`${component}_us`] ?? null,
    sanitized_input_hash: timings[`${component}_input_hash`] || null,
    sanitized_output_hash: timings[`${component}_output_hash`] || null,
    result: timings[`${component}_result`] || (timings[`${component}_us`] == null ? 'NOT_INSTRUMENTED' : 'OK'),
    failure_class: null,
  }));
}

export const LATENCY_FIELDS_US = Object.freeze([
  'browser_action_to_request_us',
  'browser_request_total_us',
  'dns_us',
  'tcp_connect_us',
  'tls_handshake_us',
  'quic_handshake_us',
  'gateway_queue_us',
  'gateway_total_us',
  'authentication_us',
  'authorization_us',
  'upstream_connect_us',
  'service_queue_us',
  'service_total_us',
  'prompt_assembly_us',
  'embedding_us',
  'retrieval_us',
  'reranker_us',
  'tool_total_us',
  'model_queue_us',
  'model_ttft_us',
  'model_generation_us',
  'schema_validation_us',
  'evidence_validation_us',
  'response_serialization_us',
  'client_parse_us',
  'react_render_us',
  'panel_ready_us',
  'browser_action_to_panel_ready_us',
  'wall_total_us',
  'unattributed_us',
]);

export function emptyLatencyRow(partial = {}) {
  const row = { measurement_status: 'NOT_INSTRUMENTED' };
  for (const f of LATENCY_FIELDS_US) row[f] = null;
  return { ...row, ...partial };
}

export function validateLatencyInvariants(row) {
  const violations = [];
  for (const f of LATENCY_FIELDS_US) {
    const v = row[f];
    if (v != null && typeof v === 'number' && v < 0) violations.push(`negative ${f}`);
  }
  const known = [
    'dns_us',
    'tcp_connect_us',
    'tls_handshake_us',
    'quic_handshake_us',
    'gateway_total_us',
    'service_total_us',
    'model_generation_us',
    'client_parse_us',
    'react_render_us',
  ];
  const sum = known.reduce((a, k) => a + (typeof row[k] === 'number' ? row[k] : 0), 0);
  if (typeof row.wall_total_us === 'number' && sum > row.wall_total_us + 1) {
    violations.push('non_overlapping_components_exceed_wall');
  }
  return { status: violations.length === 0 ? 'PASS' : 'FAIL', violations };
}

export function validateResourceTelemetryPair(sample) {
  const violations = [];
  if (sample.heap_used_mb != null && sample.heap_total_mb != null) {
    if (sample.heap_used_mb > sample.heap_total_mb + 1e-6) {
      violations.push('heap_used_gt_heap_total');
    }
  }
  if (sample.heap_used_mb != null && sample.rss_mb != null && sample.heap_used_mb > sample.rss_mb + 0.5) {
    violations.push('HEAP_USED_EXCEEDS_RSS');
  }
  if (!sample.timestamp) violations.push('missing_timestamp');
  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    classification: violations.includes('HEAP_USED_EXCEEDS_RSS')
      ? 'RESOURCE_TELEMETRY_RSS_HEAP_INVARIANT_FAILURE'
      : null,
  };
}

/**
 * Fail-closed gate for product sessions.
 */
export function classifyProductHardFailure(sessionResult = {}) {
  const checks = [
    ['browser_journey_failure', sessionResult.browser_journey_status === 'FAIL'],
    ['client_api_mismatch', sessionResult.ui_api_reconciliation_status === 'FAIL'],
    ['protocol_failure', sessionResult.protocol_status === 'FAIL'],
    ['fallback', sessionResult.protocol_fallback === true],
    ['schema_failure', sessionResult.schema_failure === true],
    ['privacy_leakage', sessionResult.privacy_violation === true],
    ['safety_violation', sessionResult.safety_violation === true],
    ['automatic_send', sessionResult.automatic_send_allowed === true],
    ['production_mutation', sessionResult.production_mutation === true],
    ['false_rarity', sessionResult.false_rarity === true],
    ['wrong_pressing', sessionResult.wrong_pressing === true],
    ['asking_as_sold', sessionResult.asking_as_sold === true],
    ['deleted_source_retrieval', sessionResult.deleted_source_retrieval === true],
    ['memory_deletion_failure', sessionResult.memory_deletion_failure === true],
    ['collector_failure', sessionResult.collector_failure === true],
    ['pcap_gap', sessionResult.pcap_gap === true],
    ['telemetry_loss', sessionResult.telemetry_loss === true],
    ['oom', sessionResult.oom === true],
    ['disk_reserve_failure', sessionResult.disk_reserve_failure === true],
    ['execution_pin_drift', sessionResult.execution_pin_drift === true],
  ];
  for (const [cls, hit] of checks) {
    if (hit) return cls;
  }
  return null;
}

export class ProductFailClosedGate {
  constructor() {
    this.blocked = false;
    this.failure_class = null;
    this.sessions_started = 0;
    this.next_session_started_after_hard_failure = 0;
  }

  canStartSession() {
    return !this.blocked;
  }

  noteSessionStart() {
    if (this.blocked) {
      this.next_session_started_after_hard_failure += 1;
      const err = new Error('next session started after hard failure');
      err.code = 'PHASE34_PRODUCT_FAIL_CLOSED_VIOLATION';
      throw err;
    }
    this.sessions_started += 1;
  }

  noteSessionResult(sessionResult) {
    const cls = classifyProductHardFailure(sessionResult);
    if (cls) {
      this.blocked = true;
      this.failure_class = cls;
    }
    return { blocked: this.blocked, failure_class: this.failure_class };
  }

  snapshot() {
    return {
      blocked: this.blocked,
      failure_class: this.failure_class,
      sessions_started: this.sessions_started,
      next_session_started_after_hard_failure: this.next_session_started_after_hard_failure,
    };
  }
}

/**
 * Capacity / rate plan — full product run exceeds 60k because of browser + multi-turn.
 */
export function buildProductCapacityPlan(opts = {}) {
  const logical = opts.logicalSessions ?? 20_000;
  const multiTurn = opts.multiTurnSessions ?? 2_000;
  const avgMultiTurns = opts.avgMultiTurns ?? 8; // mid of 4–12
  const singleTurn = logical - multiTurn;
  const browserJourneys = singleTurn * 1 + multiTurn * avgMultiTurns;
  const protocolProbes = browserJourneys * 3;
  const totalHttpRequests = browserJourneys + protocolProbes;
  const gatewayLimitPerMin = opts.gatewayLimitPerMin ?? 300;
  const safeRatePerMin = Math.floor(gatewayLimitPerMin * 0.7);
  const interBatchMs = opts.interBatchMs ?? 1000;
  const projectedFullMinutes = Math.ceil(browserJourneys * (interBatchMs / 60000));
  const projectedCanaryMinutes = Math.ceil((240 * 1.2) * (interBatchMs / 60000));
  return {
    schema_version: 'phase34-product-capacity-plan-v1',
    browser_request_count: browserJourneys,
    protocol_h1_h2_h3_request_count: protocolProbes,
    multi_turn_additional_browser_requests: multiTurn * (avgMultiTurns - 1),
    total_http_requests: totalHttpRequests,
    model_invocation_count_estimate: browserJourneys,
    tool_retrieval_count_estimate: browserJourneys * 2,
    gateway_request_rate_limit_per_min: gatewayLimitPerMin,
    safe_request_rate_per_min: safeRatePerMin,
    maximum_browser_concurrency: 1,
    maximum_protocol_triplet_concurrency: 1,
    inter_batch_interval_ms: interBatchMs,
    projected_canary_runtime_min: projectedCanaryMinutes,
    projected_full_runtime_min: projectedFullMinutes,
    projected_full_runtime_hours: Number((projectedFullMinutes / 60).toFixed(2)),
    projected_evidence_size_gb: Number(((totalHttpRequests * 8) / 1e6).toFixed(2)),
    projected_pcap_size_gb: Number(((totalHttpRequests * 4) / 1e6).toFixed(2)),
    disk_reserve_gb: 50,
    note: 'Not 20000×3 only — browser journeys and multi-turn turns add requests. Unplanned HTTP 429 is a hard failure.',
  };
}

/**
 * Human review workflow — import validation (no synthesized scores).
 */
export function validateHumanReviewImport(packageItems, completedReviews) {
  const items = packageItems || [];
  const reviews = completedReviews || [];
  const seen = new Set();
  const duplicates = [];
  for (const r of reviews) {
    const key = `${r.item_id}|${r.reviewer_id_hash}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  const reviewerIds = new Set(reviews.map((r) => r.reviewer_id_hash).filter(Boolean));
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(reviews.map((r) => ({ i: r.item_id, r: r.reviewer_id_hash, s: r.scores }))))
    .digest('hex');
  return {
    human_review_package_items: items.length,
    completed_human_reviews: reviews.length,
    unique_human_reviewers: reviewerIds.size,
    duplicate_reviews: duplicates.length,
    duplicates,
    inter_rater_agreement: reviews.length >= 2 ? 'NOT_COMPUTED_UNTIL_PAIRED' : 'NOT_AVAILABLE',
    mean_usefulness: 'NOT_AVAILABLE',
    review_package_hash: hash,
    HUMAN_REVIEW_ACCEPTANCE: reviews.length >= 800 ? 'COMPLETE' : 'NOT_EXECUTED',
    PRODUCT_EVIDENCE_COMPLETENESS_GATE: reviews.length >= 800 ? 'REVIEW_COUNT_MET' : 'REVIEW_COUNT_UNMET',
  };
}

export function exportSanitizedReviewItem(sessionEvidence) {
  return {
    item_id: sessionEvidence.session_id,
    capability: sessionEvidence.capability,
    scenario_id: sessionEvidence.scenario_id,
    screenshot_ref: sessionEvidence.screenshot_ref || null,
    api_evidence_summary_hash: sessionEvidence.accepted_response_hash || null,
    rendered_summary_hash: sessionEvidence.rendered_result_hash || null,
    blinded_candidate_label: sessionEvidence.blinded_candidate_label || null,
    private_fields_redacted: true,
  };
}

/**
 * Percentile support classification (nearest-rank).
 */
export function classifyPercentileSupport(sampleCount, percentile) {
  if (!sampleCount || sampleCount <= 0) {
    return { support_class: 'NOT_ESTIMABLE', expected_tail_observations: 0 };
  }
  if (percentile >= 100) {
    return { support_class: 'SUPPORTED', expected_tail_observations: 1 };
  }
  const expectedAbove = sampleCount * (1 - percentile / 100);
  if (expectedAbove < 1) {
    return { support_class: 'NOT_ESTIMABLE', expected_tail_observations: expectedAbove };
  }
  return {
    support_class: expectedAbove >= 10 ? 'SUPPORTED' : 'LOW_SAMPLE_ESTIMATE',
    expected_tail_observations: expectedAbove,
  };
}

export function writeCapacityPlan(outDir, plan) {
  fs.mkdirSync(outDir, { recursive: true });
  const fp = path.join(outDir, 'capacity-plan.json');
  fs.writeFileSync(fp, JSON.stringify(plan, null, 2) + '\n');
  return fp;
}
