/**
 * Bounded auction-monitor outbox publish metrics.
 * Labels are low-cardinality only (result / reason_class / stage). Never label with
 * outbox IDs, event IDs, listing IDs, payloads, exception text, or topic/partition/offset.
 */
import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "@common/utils";
import { isForbiddenMetricLabel } from "./outbox-publish-accounting.js";

let selectedTotal: Counter | undefined;
let produceAttemptTotal: Counter | undefined;
let brokerAckTotal: Counter | undefined;
let dbAckTotal: Counter | undefined;
let dbAckFailureTotal: Counter | undefined;
let retryTotal: Counter | undefined;
let failureTotal: Counter | undefined;
let createdCommittedTotal: Counter | undefined;
let dbAcknowledgedCommittedTotal: Counter | undefined;
let reopenedCommittedTotal: Counter | undefined;
let deletedUnpublishedCommittedTotal: Counter | undefined;
let pendingGauge: Gauge | undefined;
let oldestPendingAge: Gauge | undefined;
let publishLatency: Histogram | undefined;
let brokerAckToDbAck: Histogram | undefined;

const ALLOWED_LABELS = new Set(["result", "reason_class", "stage"]);

function assertLabels(labelNames: string[]): void {
  for (const name of labelNames) {
    if (isForbiddenMetricLabel(name) || !ALLOWED_LABELS.has(name)) {
      throw new Error(`forbidden or unknown metric label: ${name}`);
    }
  }
}

function assertCommittedRowCount(name: string, count: number): void {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
    throw new Error(`${name} committed rowCount must be a non-negative finite integer`);
  }
}

function ensure(): void {
  if (selectedTotal) return;

  assertLabels(["result"]);

  selectedTotal = new Counter({
    name: "auction_monitor_outbox_selected_total",
    help: "Outbox rows selected for publish (FOR UPDATE SKIP LOCKED batch).",
    labelNames: ["result"],
  });

  produceAttemptTotal = new Counter({
    name: "auction_monitor_outbox_produce_attempt_total",
    help: "Kafka produce attempts for outbox rows.",
    labelNames: ["result"],
  });

  brokerAckTotal = new Counter({
    name: "auction_monitor_outbox_broker_ack_total",
    help: "Rows for which KafkaJS returned RecordMetadata (broker acknowledgment).",
    labelNames: ["result"],
  });

  dbAckTotal = new Counter({
    name: "auction_monitor_outbox_db_ack_total",
    help: "Rows transitioned to published=true after broker acknowledgment.",
    labelNames: ["result"],
  });

  dbAckFailureTotal = new Counter({
    name: "auction_monitor_outbox_db_ack_failure_total",
    help: "DB acknowledgment failures after successful broker acknowledgment.",
    labelNames: ["result"],
  });

  retryTotal = new Counter({
    name: "auction_monitor_outbox_retry_total",
    help: "Outbox publish retries by bounded reason class.",
    labelNames: ["reason_class"],
  });

  failureTotal = new Counter({
    name: "auction_monitor_outbox_failure_total",
    help: "Outbox publish failures by bounded reason class.",
    labelNames: ["reason_class"],
  });

  /*
   * Unlabeled counters are initialized at zero by prom-client. This keeps
   * zero-transition series present without fabricating transition events.
   */
  createdCommittedTotal = new Counter({
    name: "auction_monitor_outbox_created_total",
    help: "Outbox rows committed as newly created unpublished rows.",
  });

  dbAcknowledgedCommittedTotal = new Counter({
    name: "auction_monitor_outbox_db_acknowledged_total",
    help: "Outbox rows committed through the published=false to published=true transition.",
  });

  reopenedCommittedTotal = new Counter({
    name: "auction_monitor_outbox_reopened_total",
    help: "Outbox rows committed through a published-to-unpublished reopen transition.",
  });

  deletedUnpublishedCommittedTotal = new Counter({
    name: "auction_monitor_outbox_deleted_unpublished_total",
    help: "Unpublished outbox rows committed as deleted.",
  });

  pendingGauge = new Gauge({
    name: "auction_monitor_outbox_pending",
    help: "Unpublished auction_monitor.outbox_events rows (best-effort refresh).",
  });

  oldestPendingAge = new Gauge({
    name: "auction_monitor_outbox_oldest_pending_age_seconds",
    help: "Age in seconds of oldest unpublished outbox row.",
  });

  publishLatency = new Histogram({
    name: "auction_monitor_outbox_publish_latency_seconds",
    help: "Outbox publish stage latency in seconds.",
    labelNames: ["stage"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  brokerAckToDbAck = new Histogram({
    name: "auction_monitor_outbox_broker_ack_to_db_ack_seconds",
    help: "Latency from broker acknowledgment to database acknowledgment.",
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  });

  for (const m of [
    selectedTotal,
    produceAttemptTotal,
    brokerAckTotal,
    dbAckTotal,
    dbAckFailureTotal,
    retryTotal,
    failureTotal,
    createdCommittedTotal,
    dbAcknowledgedCommittedTotal,
    reopenedCommittedTotal,
    deletedUnpublishedCommittedTotal,
    pendingGauge,
    oldestPendingAge,
    publishLatency,
    brokerAckToDbAck,
  ]) {
    register.registerMetric(m);
  }
}

/**
 * Records rows that were successfully inserted into outbox_events and whose
 * surrounding transaction has committed.
 */
export function incOutboxCreatedCommitted(committedRowCount: number): void {
  assertCommittedRowCount("created", committedRowCount);
  if (committedRowCount === 0) return;

  ensure();
  createdCommittedTotal!.inc(committedRowCount);
}

/**
 * Records committed published=false → published=true transitions.
 *
 * A mismatch is rejected before the counter changes. Call this only after the
 * database statement has successfully returned.
 */
export function incOutboxDbAcknowledgedCommitted(
  actualRowCount: number,
  expectedRowCount: number,
): void {
  assertCommittedRowCount("db acknowledged actual", actualRowCount);
  assertCommittedRowCount("db acknowledged expected", expectedRowCount);

  if (actualRowCount !== expectedRowCount) {
    throw new Error(
      `DB acknowledgment committed rowCount mismatch: actual=${actualRowCount} expected=${expectedRowCount}`,
    );
  }

  if (actualRowCount === 0) return;

  ensure();
  dbAcknowledgedCommittedTotal!.inc(actualRowCount);
}

/** Records real committed reopen transitions only. */
export function incOutboxReopenedCommitted(committedRowCount: number): void {
  assertCommittedRowCount("reopened", committedRowCount);
  if (committedRowCount === 0) return;

  ensure();
  reopenedCommittedTotal!.inc(committedRowCount);
}

/** Records real committed deletion of unpublished rows only. */
export function incOutboxDeletedUnpublishedCommitted(committedRowCount: number): void {
  assertCommittedRowCount("deleted unpublished", committedRowCount);
  if (committedRowCount === 0) return;

  ensure();
  deletedUnpublishedCommittedTotal!.inc(committedRowCount);
}

export function incOutboxSelected(result: "ok" | "empty" | "error" = "ok", n = 1): void {
  ensure();
  selectedTotal!.inc({ result }, n);
}

export function incOutboxProduceAttempt(result: "ok" | "error" = "ok"): void {
  ensure();
  produceAttemptTotal!.inc({ result });
}

export function incOutboxBrokerAck(result: "ok" | "error" = "ok"): void {
  ensure();
  brokerAckTotal!.inc({ result });
}

export function incOutboxDbAck(result: "ok" | "error" = "ok"): void {
  ensure();
  dbAckTotal!.inc({ result });
}

export function incOutboxDbAckFailure(result: "error" = "error"): void {
  ensure();
  dbAckFailureTotal!.inc({ result });
}

export function incOutboxRetry(reasonClass: string): void {
  ensure();
  retryTotal!.inc({ reason_class: reasonClass.slice(0, 64) });
}

export function incOutboxFailure(reasonClass: string): void {
  ensure();
  failureTotal!.inc({ reason_class: reasonClass.slice(0, 64) });
}

export function setOutboxPending(n: number): void {
  ensure();
  pendingGauge!.set(Number.isFinite(n) ? n : 0);
}

export function setOutboxOldestPendingAgeSeconds(sec: number): void {
  ensure();
  oldestPendingAge!.set(Number.isFinite(sec) && sec > 0 ? sec : 0);
}

export function observeOutboxPublishLatency(stage: string, seconds: number): void {
  ensure();
  if (!Number.isFinite(seconds) || seconds < 0) return;
  publishLatency!.observe({ stage: stage.slice(0, 64) }, seconds);
}

export function observeBrokerAckToDbAckSeconds(seconds: number): void {
  ensure();
  if (!Number.isFinite(seconds) || seconds < 0) return;
  brokerAckToDbAck!.observe(seconds);
}

/**
 * Eagerly register all outbox publish counters (including provenance series at 0).
 * Call at process boot and before /metrics so scrapes always export the four
 * exact provenance series even before any committed transition.
 */
export function registerOutboxPublishMetrics(): void {
  ensure();
}

/** Test helper: metric names registered by this module. */
export function listOutboxMetricNames(): string[] {
  registerOutboxPublishMetrics();
  return [
    "auction_monitor_outbox_selected_total",
    "auction_monitor_outbox_produce_attempt_total",
    "auction_monitor_outbox_broker_ack_total",
    "auction_monitor_outbox_db_ack_total",
    "auction_monitor_outbox_db_ack_failure_total",
    "auction_monitor_outbox_retry_total",
    "auction_monitor_outbox_failure_total",
    "auction_monitor_outbox_created_total",
    "auction_monitor_outbox_db_acknowledged_total",
    "auction_monitor_outbox_reopened_total",
    "auction_monitor_outbox_deleted_unpublished_total",
    "auction_monitor_outbox_pending",
    "auction_monitor_outbox_oldest_pending_age_seconds",
    "auction_monitor_outbox_publish_latency_seconds",
    "auction_monitor_outbox_broker_ack_to_db_ack_seconds",
  ];
}
