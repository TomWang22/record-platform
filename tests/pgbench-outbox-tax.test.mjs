/**
 * Cell-matched OUTBOX_DB_TAX + W1/W2 equivalence guard.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertWorkloadEquivalence,
  computeCellMatchedOutboxTax,
  summarizeOutboxTax,
} from "../scripts/lib/pgbench_outbox_tax.mjs";

function base(overrides = {}) {
  return {
    owner: "records",
    mode: "PER_OWNER_CEILING",
    distribution: "UNIFORM",
    clients: 8,
    threads: 8,
    repetition: 1,
    random_seed: 42,
    warmup_seconds: 30,
    measured_seconds: 120,
    status: "PASS",
    tps: 100,
    avg_latency_ms: 10,
    p50: 9,
    p95: 12,
    p99: 15,
    ...overrides,
  };
}

describe("workload equivalence + outbox tax", () => {
  it("passes equivalence when W1/W2 share corpus dimensions", () => {
    const w1 = base({ workload: "W1_DOMAIN_ONLY" });
    const w2 = base({ workload: "W2_DOMAIN_PLUS_OUTBOX", avg_latency_ms: 17, tps: 60 });
    const eq = assertWorkloadEquivalence(w1, w2);
    assert.equal(eq.ok, true);
  });

  it("fails equivalence on seed/client mismatch", () => {
    const w1 = base({ workload: "W1_DOMAIN_ONLY" });
    const w2 = base({ workload: "W2_DOMAIN_PLUS_OUTBOX", clients: 16 });
    const eq = assertWorkloadEquivalence(w1, w2);
    assert.equal(eq.ok, false);
    assert.equal(eq.reason, "WORKLOAD_CONTRACT_MISMATCH");
  });

  it("computes cell-matched tax and marks INVALID on mismatch", () => {
    const results = [
      base({ workload: "W1_DOMAIN_ONLY", cell_id: "w1" }),
      base({
        workload: "W2_DOMAIN_PLUS_OUTBOX",
        avg_latency_ms: 17,
        tps: 60,
        cell_id: "w2",
      }),
      base({
        owner: "media",
        workload: "W1_DOMAIN_ONLY",
        cell_id: "m1",
        avg_latency_ms: 12,
      }),
      base({
        owner: "media",
        workload: "W2_DOMAIN_PLUS_OUTBOX",
        clients: 16,
        cell_id: "m2",
        avg_latency_ms: 10,
      }),
    ];
    const taxes = computeCellMatchedOutboxTax(results);
    const records = taxes.find((t) => t.owner === "records");
    assert.equal(records.status, "OK");
    assert.ok(Math.abs(records.OUTBOX_DB_TAX_ABS - 7) < 1e-9);
    assert.ok(records.OUTBOX_DB_TAX_PERCENT > 0);
    assert.ok(records.OUTBOX_TPS_TAX_PERCENT > 0);

    const media = taxes.find((t) => t.owner === "media");
    assert.equal(media.status, "INVALID");
    assert.equal(media.reason, "WORKLOAD_CONTRACT_MISMATCH");
    assert.equal(media.OUTBOX_DB_TAX_ABS, null);
  });

  it("summary reports sample counts without averaging mismatched pairs", () => {
    const taxes = [
      {
        owner: "records",
        status: "OK",
        OUTBOX_DB_TAX_ABS: 7,
        OUTBOX_DB_TAX_PERCENT: 70,
        OUTBOX_TPS_TAX_PERCENT: 40,
      },
      {
        owner: "media",
        status: "INVALID",
        reason: "WORKLOAD_CONTRACT_MISMATCH",
        OUTBOX_DB_TAX_ABS: null,
      },
    ];
    const s = summarizeOutboxTax(taxes);
    assert.equal(s.valid_pairs, 1);
    assert.equal(s.invalid_pairs, 1);
    assert.equal(s.mean_abs_tax, 7);
  });
});
