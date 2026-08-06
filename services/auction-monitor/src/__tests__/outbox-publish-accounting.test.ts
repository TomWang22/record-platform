import { describe, it, expect } from "vitest";
import {
  createBatchLedger,
  hashCorrelationId,
  isForbiddenMetricLabel,
  markNotAttempted,
  parseBrokerMetadata,
  reconcileBatch,
  recordDatabaseAckOutcome,
  recordProduceOutcome,
  recordSelected,
} from "../outbox-publish-accounting.js";

describe("auction-monitor outbox publish accounting", () => {
  it("counts broker ack exactly once on successful metadata", () => {
    const ledger = createBatchLedger("inv-1", "batch-1");
    recordSelected(ledger, ["a"]);
    const broker = parseBrokerMetadata("dev.auction_monitor.events", [
      { topicName: "dev.auction_monitor.events", partition: 0, offset: "42" },
    ]);
    expect(broker).not.toBeNull();
    const r1 = recordProduceOutcome(ledger, "a", 1, broker, false);
    expect(r1).toBe("BROKER_ACKNOWLEDGED");
    expect(ledger.broker_acknowledged).toBe(1);
    expect(ledger.produce_attempted).toBe(1);
    // duplicate callback must not be applied by caller; single recordProduceOutcome = once
    expect(ledger.broker_acknowledged).toBe(1);
  });

  it("never increments broker ack on send failure or missing metadata", () => {
    const ledger = createBatchLedger("inv-2", "batch-2");
    recordSelected(ledger, ["b", "c"]);
    expect(parseBrokerMetadata("t", undefined)).toBeNull();
    expect(parseBrokerMetadata("t", [{ partition: 1 }])).toBeNull();
    recordProduceOutcome(ledger, "b", 1, null, true);
    recordProduceOutcome(ledger, "c", 1, null, false);
    expect(ledger.broker_acknowledged).toBe(0);
    expect(ledger.broker_send_failed).toBe(2);
  });

  it("increments DB ack exactly once after successful affected-row update", () => {
    const ledger = createBatchLedger("inv-3", "batch-3");
    recordSelected(ledger, ["d"]);
    recordProduceOutcome(ledger, "d", 1, { topic: "t", partition: 0, offset: "1" }, false);
    const r = recordDatabaseAckOutcome(ledger, "d", 1, false);
    expect(r).toBe("DATABASE_ACKNOWLEDGED");
    expect(ledger.database_acknowledged).toBe(1);
  });

  it("emits distinct DATABASE_ACK_FAILED_AFTER_BROKER_ACK gap state", () => {
    const ledger = createBatchLedger("inv-4", "batch-4");
    recordSelected(ledger, ["e"]);
    recordProduceOutcome(ledger, "e", 1, { topic: "t", partition: 2, offset: "9" }, false);
    const r = recordDatabaseAckOutcome(ledger, "e", 0, true);
    expect(r).toBe("DATABASE_ACK_FAILED_AFTER_BROKER_ACK");
    expect(ledger.database_acknowledged).toBe(0);
    expect(ledger.database_ack_failed_after_broker_ack).toBe(1);
    const recon = reconcileBatch(ledger);
    expect(recon.broker_equation).toBe(true);
  });

  it("reconciles selected = broker_ack + broker_fail + not_attempted", () => {
    const ledger = createBatchLedger("inv-5", "batch-5");
    recordSelected(ledger, ["f", "g", "h"]);
    recordProduceOutcome(ledger, "f", 1, { topic: "t", partition: 0, offset: "1" }, false);
    recordDatabaseAckOutcome(ledger, "f", 1, false);
    recordProduceOutcome(ledger, "g", 1, null, true);
    markNotAttempted(ledger, "h", "batch_stopped");
    const recon = reconcileBatch(ledger);
    expect(recon.ok).toBe(true);
    expect(ledger.selected).toBe(3);
  });

  it("rejects forbidden metric labels", () => {
    for (const l of ["outbox_id", "event_id", "listing_id", "user_id", "payload", "exception_text", "partition", "offset"]) {
      expect(isForbiddenMetricLabel(l)).toBe(true);
    }
    expect(isForbiddenMetricLabel("result")).toBe(false);
  });

  it("hashes correlation ids without exposing raw uuid in hash helper output length", () => {
    const h = hashCorrelationId("00000000-0000-4000-8000-000000000001");
    expect(h).toHaveLength(16);
    expect(h).not.toContain("-");
  });

  it("fails closed when kafka metadata missing", () => {
    expect(parseBrokerMetadata("t", [])).toBeNull();
    expect(parseBrokerMetadata("t", [{ topicName: "t", partition: 0, offset: "" }])).toBeNull();
  });
});
