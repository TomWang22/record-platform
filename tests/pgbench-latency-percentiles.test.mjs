/**
 * Latency percentile derivation from pgbench -l samples (not avg/stddev).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePgbenchLatencyLog,
  percentilesFromSamples,
} from "../scripts/lib/pgbench_latency.mjs";

describe("pgbench latency percentiles", () => {
  it("derives p50/p95/p99/max from samples", () => {
    const samples = [];
    for (let i = 1; i <= 100; i++) samples.push(i);
    const p = percentilesFromSamples(samples);
    assert.equal(p.p50, 50);
    assert.equal(p.p95, 95);
    assert.equal(p.p99, 99);
    assert.equal(p.max, 100);
    assert.equal(p.n, 100);
  });

  it("parses pgbench -l lines into ms samples", () => {
    // client_id transaction_no time script_no time_epoch time_us
    const text = [
      "0 0 1234 0 1700000000.0 1234000",
      "0 1 2500 0 1700000001.0 2500000",
      "1 0 900 0 1700000000.5 900000",
    ].join("\n");
    const samples = parsePgbenchLatencyLog(text);
    assert.deepEqual(samples, [1.234, 2.5, 0.9]);
  });

  it("records METRIC_UNAVAILABLE when no samples", () => {
    const p = percentilesFromSamples([]);
    assert.equal(p.status, "METRIC_UNAVAILABLE");
    assert.equal(p.p95, null);
  });
});
