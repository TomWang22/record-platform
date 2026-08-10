/**
 * Track C — outbox lifecycle evidence recorder (harness stub; no live publish).
 */
import {
  LIFECYCLE_STATES,
  MUTUALLY_EXCLUSIVE_TERMINALS,
  REQUIRED_LIFECYCLE_STATES_FOR_PASS,
} from "./performance_track_c.mjs";

export const FROZEN_IDENTITY_FIELDS = [
  "run_id",
  "event_id",
  "outbox_primary_key",
  "payload_sha256",
  "producer_principal",
  "producer_client_id",
  "topic",
  "partition",
  "offset",
  "time_covered_leader_broker",
  "consumer_group",
  "consumer_principal",
  "consumer_offset",
  "business_effect_identifier",
];

export const LATENCY_BUCKETS = [
  "insert_to_selection",
  "selection_to_produce",
  "produce_to_broker_ack",
  "broker_ack_to_db_ack",
  "broker_ack_to_consumer_receipt",
  "consumer_receipt_to_offset_commit",
  "consumer_receipt_to_business_effect",
  "insert_to_final_business_effect",
];

export const LATENCY_ENDPOINT_PAIRS = Object.freeze({
  insert_to_selection: ["created", "selected"],
  selection_to_produce: ["selected", "produce_attempted"],
  produce_to_broker_ack: ["produce_attempted", "broker_acknowledged"],
  broker_ack_to_db_ack: ["broker_acknowledged", "db_acknowledged"],
  broker_ack_to_consumer_receipt: ["broker_acknowledged", "consumed"],
  consumer_receipt_to_offset_commit: ["consumed", "offset_committed"],
  consumer_receipt_to_business_effect: ["consumed", "business_effect_applied"],
  insert_to_final_business_effect: ["created", "business_effect_applied"],
});

export const FAILURE_RECOVERY_SCENARIOS = [
  "broker_unavailable",
  "publisher_restart_after_selection",
  "publisher_restart_after_broker_ack_before_db_ack",
  "database_ack_failure",
  "duplicate_delivery",
  "consumer_restart",
  "consumer_rebalance",
  "poison_event",
  "retry_exhaustion",
  "dlq_disposition",
  "out_of_order_arrival_where_ordering_required",
];

export class OutboxLifecycleEvidenceError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = "OutboxLifecycleEvidenceError";
    this.failures = failures;
  }
}

export function createEmptyLatencyStats() {
  return Object.fromEntries(
    LATENCY_BUCKETS.map((bucket) => [
      bucket,
      { p50: null, p95: null, p99: null, max: null, failures: 0, retries: 0, unknowns: 0 },
    ]),
  );
}

export function createLifecycleRecorder({ runId, outboxTable, executionAuthorized = false }) {
  if (executionAuthorized === true) {
    throw new OutboxLifecycleEvidenceError("execution_authorized_must_be_false");
  }
  return {
    schema: "outbox-lifecycle-evidence/v1",
    execution_authorized: false,
    lifecycle_publish_executed: false,
    run_id: runId,
    outbox_table: outboxTable,
    row_key: {
      run_id: runId,
      event_id: null,
      outbox_primary_key: null,
    },
    frozen_identity: Object.fromEntries(FROZEN_IDENTITY_FIELDS.map((f) => [f, null])),
    lifecycle_states_observed: [],
    latency: createEmptyLatencyStats(),
    failure_recovery_rows: [],
    rows: [],
    verdict: null,
  };
}

export function setFrozenIdentity(recorder, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!FROZEN_IDENTITY_FIELDS.includes(key)) {
      throw new OutboxLifecycleEvidenceError(`unknown_frozen_identity_field:${key}`);
    }
    if (value === undefined) {
      throw new OutboxLifecycleEvidenceError(`frozen_identity_invented:${key}`);
    }
    recorder.frozen_identity[key] = value;
  }
  recorder.row_key = {
    run_id: recorder.frozen_identity.run_id ?? recorder.run_id,
    event_id: recorder.frozen_identity.event_id,
    outbox_primary_key: recorder.frozen_identity.outbox_primary_key,
  };
  return recorder;
}

export function recordLifecycleState(recorder, state, at = null) {
  if (!LIFECYCLE_STATES.includes(state)) {
    throw new OutboxLifecycleEvidenceError(`unknown_lifecycle_state:${state}`);
  }
  recorder.lifecycle_states_observed.push({ state, at });
  return recorder;
}

export function recordFailureRecoveryRow(recorder, scenario, classification) {
  if (!FAILURE_RECOVERY_SCENARIOS.includes(scenario)) {
    throw new OutboxLifecycleEvidenceError(`unknown_failure_scenario:${scenario}`);
  }
  recorder.failure_recovery_rows.push({ scenario, classification, at: null });
  return recorder;
}

/**
 * Latency is computed only when both endpoints exist.
 * Missing endpoint → unknown (never invent zero).
 */
export function computeLatencyMs(startAt, endAt) {
  if (startAt == null || endAt == null) {
    return { duration_ms: null, unknown: true };
  }
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { duration_ms: null, unknown: true };
  }
  return { duration_ms: end - start, unknown: false };
}

export function stateTimestamp(recorder, state) {
  const hit = [...(recorder.lifecycle_states_observed || [])]
    .reverse()
    .find((entry) => entry.state === state);
  return hit?.at ?? null;
}

export function deriveLatencyFromEndpoints(recorder) {
  for (const [bucket, [startState, endState]] of Object.entries(LATENCY_ENDPOINT_PAIRS)) {
    const computed = computeLatencyMs(
      stateTimestamp(recorder, startState),
      stateTimestamp(recorder, endState),
    );
    if (computed.unknown) {
      recordLatencyObservation(recorder, bucket, { unknown: true });
    } else {
      recordLatencyObservation(recorder, bucket, {
        duration_ms: computed.duration_ms,
        failed: false,
        retry: false,
      });
    }
  }
  return recorder;
}

export function recordLatencyObservation(recorder, bucket, observation) {
  if (!LATENCY_BUCKETS.includes(bucket)) {
    throw new OutboxLifecycleEvidenceError(`unknown_latency_bucket:${bucket}`);
  }
  const stats = recorder.latency[bucket];
  if (observation?.unknown === true || observation?.duration_ms == null) {
    stats.unknowns += 1;
    return recorder;
  }
  const ms = observation.duration_ms;
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    stats.unknowns += 1;
    return recorder;
  }
  if (observation.failed === true) stats.failures += 1;
  if (observation.retry === true) stats.retries += 1;
  if (stats.max === null || ms > stats.max) stats.max = ms;
  if (stats.p50 === null) stats.p50 = ms;
  if (stats.p95 === null || ms >= stats.p95) stats.p95 = ms;
  if (stats.p99 === null || ms >= stats.p99) stats.p99 = ms;
  return recorder;
}

export function assertMutuallyExclusiveTerminal(recorder) {
  const terminals = recorder.lifecycle_states_observed
    .map((s) => s.state)
    .filter((s) => MUTUALLY_EXCLUSIVE_TERMINALS.includes(s));
  if (terminals.length > 1) {
    throw new OutboxLifecycleEvidenceError(
      `mutually_exclusive_terminal_violation:${terminals.join("|")}`,
    );
  }
  return true;
}

export function assertZeroUnknowns(recorder) {
  const failures = [];
  for (const bucket of LATENCY_BUCKETS) {
    const unknowns = recorder.latency[bucket]?.unknowns ?? 0;
    if (unknowns !== 0) failures.push(`${bucket}:unknowns=${unknowns}`);
  }
  if (failures.length) {
    throw new OutboxLifecycleEvidenceError(
      `unknowns_must_be_zero:${failures.join(",")}`,
      failures,
    );
  }
  return true;
}

export function requiredLifecycleStatesForPass() {
  return [...REQUIRED_LIFECYCLE_STATES_FOR_PASS];
}

export function finalizeLifecycleEvidence(recorder, { allowIncomplete = false } = {}) {
  assertMutuallyExclusiveTerminal(recorder);
  const required = requiredLifecycleStatesForPass();
  const observed = new Set(recorder.lifecycle_states_observed.map((s) => s.state));
  const missing = required.filter((s) => !observed.has(s));
  for (const field of FROZEN_IDENTITY_FIELDS) {
    if (recorder.frozen_identity[field] === null) {
      missing.push(`identity:${field}`);
    }
  }
  if (!recorder.row_key?.run_id || !recorder.row_key?.event_id || !recorder.row_key?.outbox_primary_key) {
    missing.push("row_key_incomplete");
  }

  if (missing.length && !allowIncomplete) {
    throw new OutboxLifecycleEvidenceError(
      `lifecycle_evidence_incomplete:${missing.join(",")}`,
      missing,
    );
  }

  try {
    assertZeroUnknowns(recorder);
  } catch (err) {
    if (!allowIncomplete) throw err;
  }

  recorder.verdict = missing.length ? "HARNESS_INCOMPLETE" : "HARNESS_PASS";
  return recorder;
}

export function classifyFailureRecoveryRow(scenario, outcome) {
  switch (scenario) {
    case "broker_unavailable":
      return outcome === "retry_scheduled" ? "recoverable" : "blocking";
    case "publisher_restart_after_selection":
      return outcome === "reselected" ? "recoverable" : "blocking";
    case "publisher_restart_after_broker_ack_before_db_ack":
      return outcome === "db_ack_completed"
        ? "recoverable"
        : outcome === "broker_ack_without_db_ack"
          ? "orphan_risk"
          : "duplicate_risk";
    case "database_ack_failure":
      return outcome === "broker_ack_without_db_ack" ? "orphan_risk" : "recoverable";
    case "duplicate_delivery":
      return outcome === "consumer_deduped" ? "benign" : "blocking";
    case "consumer_restart":
      return outcome === "offset_replayed" ? "recoverable" : "blocking";
    case "consumer_rebalance":
      return outcome === "rebalanced_ok" ? "recoverable" : "blocking";
    case "poison_event":
      return outcome === "dead_lettered" ? "terminal" : "blocking";
    case "retry_exhaustion":
      return outcome === "dead_lettered" ? "terminal" : "blocking";
    case "dlq_disposition":
      return outcome === "dead_lettered" ? "terminal" : "blocking";
    case "out_of_order_arrival_where_ordering_required":
      return outcome === "reordered_or_quarantined" ? "recoverable" : "blocking";
    default: {
      const _exhaustive = scenario;
      throw new OutboxLifecycleEvidenceError(`unhandled_scenario:${_exhaustive}`);
    }
  }
}

export function buildFixtureLifecycleEvidence({ outboxTable = "auction_monitor.outbox_events" } = {}) {
  const recorder = createLifecycleRecorder({
    runId: "track-c-fixture-run",
    outboxTable,
  });
  setFrozenIdentity(recorder, {
    run_id: "track-c-fixture-run",
    event_id: "00000000-0000-4000-8000-000000000001",
    outbox_primary_key: "00000000-0000-4000-8000-000000000001",
    payload_sha256: "fixture-payload-sha256-not-live",
    producer_principal: "CN=auction-monitor",
    producer_client_id: "auction-monitor-outbox-publisher",
    topic: "dev.auction_monitor.events",
    partition: 0,
    offset: "0",
    time_covered_leader_broker: "kafka-0",
    consumer_group: "fixture-consumer",
    consumer_principal: "CN=fixture-consumer",
    consumer_offset: "0",
    business_effect_identifier: "fixture-business-effect",
  });
  const timeline = {
    created: "1970-01-01T00:00:00.000Z",
    selected: "1970-01-01T00:00:00.010Z",
    produce_attempted: "1970-01-01T00:00:00.020Z",
    broker_acknowledged: "1970-01-01T00:00:00.030Z",
    db_acknowledged: "1970-01-01T00:00:00.040Z",
    consumed: "1970-01-01T00:00:00.050Z",
    offset_committed: "1970-01-01T00:00:00.060Z",
    business_effect_applied: "1970-01-01T00:00:00.070Z",
  };
  for (const state of requiredLifecycleStatesForPass()) {
    recordLifecycleState(recorder, state, timeline[state]);
  }
  deriveLatencyFromEndpoints(recorder);
  recordFailureRecoveryRow(
    recorder,
    "duplicate_delivery",
    classifyFailureRecoveryRow("duplicate_delivery", "consumer_deduped"),
  );
  finalizeLifecycleEvidence(recorder);
  return recorder;
}
