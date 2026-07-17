/**
 * Phase 34 product gauntlet — session / turn / invocation / latency contracts.
 * Ledgers never store private raw content.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PRODUCT_SESSION_LEDGER_VERSION = 'phase34-product-session-ledger-v1';
export const PRODUCT_TURN_LEDGER_VERSION = 'phase34-product-turn-ledger-v1';
export const PRODUCT_INVOCATION_LEDGER_VERSION = 'phase34-product-invocation-ledger-v1';
export const PRODUCT_LATENCY_SCHEMA_VERSION = 'phase34-product-latency-v1';

export const LINK_FIELDS = Object.freeze([
  'session_id',
  'turn_id',
  'journey_id',
  'triplet_id',
  'canonical_request_hash',
  'participant_id_hash',
  'capability',
  'scenario_id',
  'evidence_snapshot_hash',
]);

export const CONFIG_PIN_FIELDS = Object.freeze([
  'prompt_configuration_id',
  'prompt_hash',
  'system_prompt_hash',
  'model_tier',
  'model_identifier',
  'model_configuration_hash',
  'retrieval_configuration_hash',
  'reranker_version',
  'tool_configuration_hash',
  'embedding_version',
]);

export const LATENCY_FIELDS_US = Object.freeze([
  'browser_action_to_request_us',
  'client_request_total_us',
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

export const JOURNEY_EVIDENCE_FIELDS = Object.freeze([
  'browser_route',
  'viewport',
  'authenticated_participant_role',
  'action_sequence',
  'network_request_id',
  'canonical_payload_hash',
  'panel_loading_state',
  'panel_ready_state',
  'rendered_structured_value_hash',
  'rendered_evidence_hash',
  'rendered_limitation_hash',
  'console_errors',
  'failed_requests',
  'accessibility_result',
  'horizontal_overflow',
  'client_protocol_observed',
  'journey_outcome',
]);

/** Empty latency row: every component null + NOT_INSTRUMENTED until wired. */
export function emptyLatencyDecomposition(partial = {}) {
  /** @type {Record<string, unknown>} */
  const row = {
    schema_version: PRODUCT_LATENCY_SCHEMA_VERSION,
    measurement_status: 'NOT_INSTRUMENTED',
  };
  for (const f of LATENCY_FIELDS_US) {
    row[f] = null;
  }
  return { ...row, ...partial };
}

/**
 * @param {object} pins
 * @returns {{ status: 'PASS'|'BLOCKED', missing: string[] }}
 */
export function assertConfigPinsPresent(pins) {
  const missing = CONFIG_PIN_FIELDS.filter((f) => pins?.[f] == null || pins[f] === '');
  return { status: missing.length === 0 ? 'PASS' : 'BLOCKED', missing };
}

/**
 * Classify whether multi-turn evidence is a real execution ledger.
 * A transcript fixture in one request is NOT multi-turn execution.
 */
export function classifyMultiTurnEvidence(session) {
  const turns = session?.turns;
  if (!Array.isArray(turns) || turns.length < 2) {
    return {
      MULTI_TURN_EXECUTION_EVIDENCE: 'NOT_INSTRUMENTED',
      reason: 'fewer than 2 executed turn ledger rows',
    };
  }
  const turnIds = new Set(turns.map((t) => t.turn_id).filter(Boolean));
  const indexes = turns.map((t) => t.turn_index);
  const ordered = indexes.every((v, i) => typeof v === 'number' && (i === 0 || v > indexes[i - 1]));
  const allLinked = turns.every(
    (t) =>
      t.session_id === session.session_id &&
      t.H1_probe_id &&
      t.H2_probe_id &&
      t.H3_probe_id &&
      t.canonical_request_hash,
  );
  if (turnIds.size === turns.length && ordered && allLinked) {
    return { MULTI_TURN_EXECUTION_EVIDENCE: 'EXECUTED_LEDGER', turn_count: turns.length };
  }
  return {
    MULTI_TURN_EXECUTION_EVIDENCE: 'TRANSCRIPT_FIXTURE_ONLY',
    reason: 'missing distinct turn_ids, ordered turn_index, or per-turn protocol linkage',
  };
}

export function hashCanonicalRequest(payload) {
  const normalized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function createSessionId(seedParts) {
  return `sess_${crypto.createHash('sha256').update(seedParts.join('|')).digest('hex').slice(0, 24)}`;
}

export function createTurnId(sessionId, turnIndex) {
  return `turn_${crypto.createHash('sha256').update(`${sessionId}|${turnIndex}`).digest('hex').slice(0, 24)}`;
}

export function createJourneyId(sessionId) {
  return `journey_${crypto.createHash('sha256').update(`journey|${sessionId}`).digest('hex').slice(0, 24)}`;
}

export function createTripletId(sessionId, turnIndex) {
  return `trip_${crypto.createHash('sha256').update(`trip|${sessionId}|${turnIndex}`).digest('hex').slice(0, 24)}`;
}

/**
 * Append-only JSONL writer for product ledgers.
 */
export class ProductLedgerWriter {
  /**
   * @param {string} outRoot
   */
  constructor(outRoot) {
    this.outRoot = outRoot;
    this.paths = {
      sessions: path.join(outRoot, 'ledgers', 'session-ledger.jsonl'),
      turns: path.join(outRoot, 'ledgers', 'turn-ledger.jsonl'),
      invocations: path.join(outRoot, 'ledgers', 'invocation-ledger.jsonl'),
      journeys: path.join(outRoot, 'ledgers', 'journey-ledger.jsonl'),
      latency: path.join(outRoot, 'ledgers', 'latency-ledger.jsonl'),
      reconciliation: path.join(outRoot, 'ledgers', 'ui-api-reconciliation.jsonl'),
    };
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.paths.sessions), { recursive: true });
    return this;
  }

  /** @param {string} relKey @param {object} row */
  append(relKey, row) {
    this.ensure();
    const fp = this.paths[relKey];
    if (!fp) throw new Error(`unknown ledger ${relKey}`);
    fs.appendFileSync(fp, `${JSON.stringify(row)}\n`);
  }
}

/**
 * Build a not-yet-executed session skeleton from a schedule row.
 * @param {object} scheduleRow
 * @param {object} [pins]
 */
export function buildSessionSkeleton(scheduleRow, pins = {}) {
  const session_id = createSessionId([
    scheduleRow.coordinate,
    scheduleRow.schedule_index,
    scheduleRow.scenario_id,
  ]);
  const journey_id = createJourneyId(session_id);
  const pinStatus = assertConfigPinsPresent(pins);
  return {
    schema_version: PRODUCT_SESSION_LEDGER_VERSION,
    session_id,
    journey_id,
    triplet_id: null,
    turn_id: null,
    canonical_request_hash: null,
    participant_id_hash: pins.participant_id_hash || null,
    capability: scheduleRow.capability,
    scenario_id: scheduleRow.scenario_id,
    evidence_snapshot_hash: null,
    schedule_index: scheduleRow.schedule_index,
    multi_turn_class: scheduleRow.multi_turn_class,
    participant_side: scheduleRow.participant_side,
    dataset_split: scheduleRow.dataset_split,
    execution_class: 'BROWSER_PLUS_PROTOCOL_TRIPLET',
    config_pins: { ...pins },
    config_pin_status: pinStatus.status,
    config_pin_missing: pinStatus.missing,
    browser_journey_status: 'NOT_EXECUTED',
    protocol_h1_status: 'NOT_EXECUTED',
    protocol_h2_status: 'NOT_EXECUTED',
    protocol_h3_status: 'NOT_EXECUTED',
    ui_api_reconciliation_status: 'NOT_EXECUTED',
    session_outcome: 'NOT_EXECUTED',
    MULTI_TURN_EXECUTION_EVIDENCE:
      scheduleRow.multi_turn_class === 'multi_4_12' ? 'PENDING' : 'N_A_SINGLE_TURN',
  };
}

/**
 * @param {object} session
 * @param {number} turnIndex
 * @param {object} fields
 */
export function buildTurnLedgerRow(session, turnIndex, fields = {}) {
  const turn_id = createTurnId(session.session_id, turnIndex);
  const triplet_id = createTripletId(session.session_id, turnIndex);
  return {
    schema_version: PRODUCT_TURN_LEDGER_VERSION,
    session_id: session.session_id,
    turn_id,
    turn_index: turnIndex,
    triplet_id,
    browser_action: fields.browser_action ?? null,
    input_hash: fields.input_hash ?? null,
    prior_state_hash: fields.prior_state_hash ?? null,
    correction_present: fields.correction_present ?? false,
    deletion_present: fields.deletion_present ?? false,
    memory_consent_state: fields.memory_consent_state ?? null,
    selected_memory_hash: fields.selected_memory_hash ?? null,
    selected_evidence_hash: fields.selected_evidence_hash ?? null,
    canonical_request_hash: fields.canonical_request_hash ?? null,
    H1_probe_id: fields.H1_probe_id ?? null,
    H2_probe_id: fields.H2_probe_id ?? null,
    H3_probe_id: fields.H3_probe_id ?? null,
    rendered_result_hash: fields.rendered_result_hash ?? null,
    turn_outcome: fields.turn_outcome ?? 'NOT_EXECUTED',
  };
}

/**
 * @param {object} link
 */
export function buildInvocationRow(link) {
  return {
    schema_version: PRODUCT_INVOCATION_LEDGER_VERSION,
    invocation_id: link.invocation_id || `inv_${crypto.randomBytes(8).toString('hex')}`,
    session_id: link.session_id,
    turn_id: link.turn_id,
    component: link.component,
    version: link.version ?? null,
    configuration_hash: link.configuration_hash ?? null,
    started_at: link.started_at ?? null,
    finished_at: link.finished_at ?? null,
    duration_us: link.duration_us ?? null,
    input_hash: link.input_hash ?? null,
    output_hash: link.output_hash ?? null,
    result: link.result ?? null,
    failure_class: link.failure_class ?? null,
  };
}

export const FORBIDDEN_API_SOAK_ROOTS = Object.freeze([
  '/tmp/phase34-live-inference-gauntlet-v1',
  '/tmp/phase34-live-inference-gauntlet-v2',
  '/tmp/phase34-live-inference-gauntlet-v3',
  '/tmp/phase34-live-inference-canary-v1',
  '/tmp/phase34-live-inference-canary-v2',
  '/tmp/phase34-live-inference-canary-v3',
  '/tmp/phase34-live-inference-canary-v4',
]);

export const PRODUCT_CANARY_ROOT = '/tmp/phase34-product-gauntlet-canary-v1';
export const PRODUCT_GAUNTLET_ROOT = '/tmp/phase34-product-gauntlet-v1';
export const PRODUCT_LIVE_SMOKE_ROOT = '/tmp/phase34-product-harness-live-smoke-v1';
export const PHASE33F_TARGET_FORBIDDEN = '/tmp/phase33f-capability-gauntlet-target-v1';

export function assertProductOutEligible(out) {
  const resolved = path.resolve(out);
  if (FORBIDDEN_API_SOAK_ROOTS.includes(resolved)) {
    const err = new Error(`refusing to reuse API-soak root ${resolved}`);
    err.code = 'PHASE34_PRODUCT_ROOT_FORBIDDEN';
    throw err;
  }
  if (resolved === PHASE33F_TARGET_FORBIDDEN) {
    const err = new Error('Phase 33F target root is forbidden');
    err.code = 'PHASE34_PRODUCT_ROOT_FORBIDDEN';
    throw err;
  }
  if (fs.existsSync(PHASE33F_TARGET_FORBIDDEN)) {
    const err = new Error('Phase 33F target must remain ABSENT');
    err.code = 'PHASE34_PRODUCT_TARGET_MUST_BE_ABSENT';
    throw err;
  }
}
