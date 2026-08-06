/**
 * Bounded auction-monitor outbox publish metrics.
 * Labels are low-cardinality only (result / reason_class / stage). Never label with
 * outbox IDs, event IDs, listing IDs, payloads, exception text, or topic/partition/offset.
 */
import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "@common/utils";

let selectedTotal: Counter | undefined;
let produceAttemptTotal: Counter | undefined;
let brokerAckTotal: Counter | undefined;
let dbAckTotal: Counter | undefined;
let retryTotal: Counter | undefined;
let failureTotal: Counter | undefined;
let pendingGauge: Gauge | undefined;
let oldestPendingAge: Gauge | undefined;
let publishLatency: Histogram | undefined;

function ensure(): void {
  if (selectedTotal) return;
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
  register.registerMetric(selectedTotal);
  register.registerMetric(produceAttemptTotal);
  register.registerMetric(brokerAckTotal);
  register.registerMetric(dbAckTotal);
  register.registerMetric(retryTotal);
  register.registerMetric(failureTotal);
  register.registerMetric(pendingGauge);
  register.registerMetric(oldestPendingAge);
  register.registerMetric(publishLatency);
}

export function incOutboxSelected(result: "ok" | "empty" | "error" = "ok"): void {
  ensure();
  selectedTotal!.inc({ result });
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
