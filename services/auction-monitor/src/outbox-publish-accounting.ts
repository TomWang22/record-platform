/**
 * Pure outbox publish row-state accounting for auction-monitor.
 * Separates SELECTED / PRODUCE / BROKER_ACK / DB_ACK — never conflates them.
 */
import { createHash } from "node:crypto";

export type OutboxRowResult =
  | "SELECTED"
  | "LEASED"
  | "PRODUCE_ATTEMPTED"
  | "BROKER_ACKNOWLEDGED"
  | "BROKER_SEND_FAILED"
  | "DATABASE_ACKNOWLEDGED"
  | "DATABASE_ACK_FAILED_AFTER_BROKER_ACK"
  | "RETRY_SCHEDULED"
  | "TERMINAL_FAILURE"
  | "NOT_ATTEMPTED";

export type BrokerMetadata = {
  topic: string;
  partition: number;
  offset: string;
};

export type RowLedgerEntry = {
  outbox_id: string;
  correlation_hash: string;
  result: OutboxRowResult;
  broker?: BrokerMetadata;
  attempt: number;
};

export type BatchLedger = {
  invocation_id: string;
  batch_id: string;
  selected: number;
  leased: number;
  produce_attempted: number;
  broker_acknowledged: number;
  broker_send_failed: number;
  database_acknowledged: number;
  database_ack_failed_after_broker_ack: number;
  retry_scheduled: number;
  terminal_failure: number;
  not_attempted: number;
  rows: RowLedgerEntry[];
};

export function hashCorrelationId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export function createBatchLedger(invocationId: string, batchId: string): BatchLedger {
  return {
    invocation_id: invocationId,
    batch_id: batchId,
    selected: 0,
    leased: 0,
    produce_attempted: 0,
    broker_acknowledged: 0,
    broker_send_failed: 0,
    database_acknowledged: 0,
    database_ack_failed_after_broker_ack: 0,
    retry_scheduled: 0,
    terminal_failure: 0,
    not_attempted: 0,
    rows: [],
  };
}

/** Count selected/leased rows (FOR UPDATE SKIP LOCKED batch). */
export function recordSelected(ledger: BatchLedger, outboxIds: string[]): void {
  ledger.selected += outboxIds.length;
  ledger.leased += outboxIds.length;
  for (const id of outboxIds) {
    ledger.rows.push({
      outbox_id: id,
      correlation_hash: hashCorrelationId(id),
      result: "LEASED",
      attempt: 0,
    });
  }
}

export function parseBrokerMetadata(
  topic: string,
  metadata: Array<{ topicName?: string; partition?: number; offset?: string }> | undefined,
): BrokerMetadata | null {
  const meta0 = Array.isArray(metadata) ? metadata[0] : undefined;
  if (!meta0 || meta0.partition === undefined || meta0.offset === undefined || meta0.offset === "") {
    return null;
  }
  return {
    topic: meta0.topicName || topic,
    partition: meta0.partition,
    offset: String(meta0.offset),
  };
}

/**
 * Apply produce outcome. Broker ack requires successful metadata; never count
 * produce-start as broker ack.
 */
export function recordProduceOutcome(
  ledger: BatchLedger,
  outboxId: string,
  attempt: number,
  broker: BrokerMetadata | null,
  sendFailed: boolean,
): OutboxRowResult {
  ledger.produce_attempted += 1;
  const entry = ledger.rows.find((r) => r.outbox_id === outboxId);
  if (sendFailed || !broker) {
    ledger.broker_send_failed += 1;
    const result: OutboxRowResult = "BROKER_SEND_FAILED";
    if (entry) {
      entry.result = result;
      entry.attempt = attempt;
    }
    return result;
  }
  ledger.broker_acknowledged += 1;
  if (entry) {
    entry.result = "BROKER_ACKNOWLEDGED";
    entry.attempt = attempt;
    entry.broker = broker;
  }
  return "BROKER_ACKNOWLEDGED";
}

/**
 * DB ack only after successful update with affected-row count >= 1.
 * Distinct gap state when DB fails after broker ack.
 */
export function recordDatabaseAckOutcome(
  ledger: BatchLedger,
  outboxId: string,
  affectedRows: number,
  dbError: boolean,
): OutboxRowResult {
  const entry = ledger.rows.find((r) => r.outbox_id === outboxId);
  if (dbError || !Number.isFinite(affectedRows) || affectedRows < 1) {
    ledger.database_ack_failed_after_broker_ack += 1;
    const result: OutboxRowResult = "DATABASE_ACK_FAILED_AFTER_BROKER_ACK";
    if (entry) entry.result = result;
    return result;
  }
  ledger.database_acknowledged += 1;
  if (entry) entry.result = "DATABASE_ACKNOWLEDGED";
  return "DATABASE_ACKNOWLEDGED";
}

export function markNotAttempted(ledger: BatchLedger, outboxId: string, reason: string): void {
  ledger.not_attempted += 1;
  const entry = ledger.rows.find((r) => r.outbox_id === outboxId);
  if (entry) {
    entry.result = "NOT_ATTEMPTED";
    (entry as RowLedgerEntry & { reason?: string }).reason = reason;
  }
}

/** Invariants for one batch (no unexplained residuals). */
export function reconcileBatch(ledger: BatchLedger): {
  ok: boolean;
  selected_equation: boolean;
  broker_equation: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const selectedEq =
    ledger.selected ===
    ledger.broker_acknowledged + ledger.broker_send_failed + ledger.not_attempted;
  if (!selectedEq) {
    errors.push(
      `selected(${ledger.selected}) != broker_ack(${ledger.broker_acknowledged})+broker_fail(${ledger.broker_send_failed})+not_attempted(${ledger.not_attempted})`,
    );
  }
  const brokerEq =
    ledger.broker_acknowledged ===
    ledger.database_acknowledged + ledger.database_ack_failed_after_broker_ack;
  // Note: inflight at window end is handled at interval aggregation, not per-batch
  // when batch completes synchronously.
  if (!brokerEq) {
    errors.push(
      `broker_ack(${ledger.broker_acknowledged}) != db_ack(${ledger.database_acknowledged})+db_fail_after(${ledger.database_ack_failed_after_broker_ack})`,
    );
  }
  return { ok: errors.length === 0, selected_equation: selectedEq, broker_equation: brokerEq, errors };
}

/** Detect forbidden unbounded metric label names. */
export function isForbiddenMetricLabel(label: string): boolean {
  const forbidden = new Set([
    "outbox_id",
    "event_id",
    "listing_id",
    "user_id",
    "payload",
    "exception_text",
    "partition",
    "offset",
  ]);
  return forbidden.has(label);
}
