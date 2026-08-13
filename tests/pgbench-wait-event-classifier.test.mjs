/**
 * PostgreSQL wait_event classifier for Gate-3/Gate-5 attribution.
 * Missing capability must stay METRIC_UNAVAILABLE — never invent zeros.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyPostgresWaitEvents,
  classifyWaitEventType,
} from "../scripts/lib/pgbench_wait_event_classifier.mjs";
import { summarizePostgresWaits } from "../scripts/lib/pgbench_owner_review.mjs";
import { POSTGRES_SAMPLE_SQL } from "../scripts/lib/pgbench_postgres_sample.mjs";

describe("pgbench wait_event classifier", () => {
  it("sampler SQL captures wait_event histograms for the classifier", () => {
    assert.match(POSTGRES_SAMPLE_SQL, /wait_events/);
    assert.match(POSTGRES_SAMPLE_SQL, /wait_event_type/);
    assert.match(POSTGRES_SAMPLE_SQL, /pg_stat_activity/);
  });

  it("maps PostgreSQL wait_event_type into lock / io / cpu without inventing buckets", () => {
    assert.equal(classifyWaitEventType("Lock"), "lock");
    assert.equal(classifyWaitEventType("LWLock"), "lock");
    assert.equal(classifyWaitEventType("BufferPin"), "lock");
    assert.equal(classifyWaitEventType("IO"), "io");
    assert.equal(classifyWaitEventType(null, { state: "active" }), "cpu");
    assert.equal(classifyWaitEventType(undefined, { state: "active" }), "cpu");
    assert.equal(classifyWaitEventType("Timeout"), "other");
    assert.equal(classifyWaitEventType("Client"), "other");
  });

  it("returns METRIC_UNAVAILABLE with null class counts when wait_events are absent", () => {
    const missing = classifyPostgresWaitEvents(null);
    assert.equal(missing.status, "METRIC_UNAVAILABLE");
    assert.equal(missing.locks, null);
    assert.equal(missing.io, null);
    assert.equal(missing.cpu, null);
    assert.ok(missing.reason);

    const noField = classifyPostgresWaitEvents({ waiting_backends: 4 });
    assert.equal(noField.status, "METRIC_UNAVAILABLE");
    assert.equal(noField.locks, null);
    assert.equal(noField.io, null);
    assert.equal(noField.cpu, null);
  });

  it("aggregates observed wait_event rows into lock / io / cpu counts", () => {
    const classified = classifyPostgresWaitEvents({
      wait_events: [
        { wait_event_type: "Lock", wait_event: "transactionid", n: 3 },
        { wait_event_type: "LWLock", wait_event: "WALWrite", n: 1 },
        { wait_event_type: "IO", wait_event: "DataFileRead", n: 5 },
        { wait_event_type: null, wait_event: null, n: 2, state: "active" },
        { wait_event_type: "Client", wait_event: "ClientRead", n: 4 },
      ],
    });
    assert.equal(classified.status, "OK");
    assert.equal(classified.locks.count, 4);
    assert.equal(classified.io.count, 5);
    assert.equal(classified.cpu.count, 2);
    assert.equal(classified.other.count, 4);
  });

  it("summarizePostgresWaits stays unavailable when samples lack wait_event histograms", () => {
    const waits = summarizePostgresWaits([
      {
        cell_id: "c1",
        postgres_samples: {
          before: { status: "OK", sample: { waiting_backends: 1, deadlocks: 0, blks_read: 10 } },
          after: { status: "OK", sample: { waiting_backends: 3, deadlocks: 0, blks_read: 20 } },
        },
      },
    ]);
    assert.equal(waits.status, "PARTIAL_OR_UNAVAILABLE");
    assert.equal(waits.locks, null);
    assert.equal(waits.io, null);
    assert.equal(waits.cpu, null);
    assert.equal(waits.classifier.status, "METRIC_UNAVAILABLE");
  });

  it("summarizePostgresWaits uses the classifier when wait_events are present", () => {
    const waits = summarizePostgresWaits([
      {
        cell_id: "c1",
        postgres_samples: {
          after: {
            status: "OK",
            sample: {
              waiting_backends: 3,
              wait_events: [
                { wait_event_type: "Lock", n: 2 },
                { wait_event_type: "IO", n: 1 },
              ],
            },
          },
        },
      },
    ]);
    assert.equal(waits.status, "OK");
    assert.equal(waits.locks.count, 2);
    assert.equal(waits.io.count, 1);
    assert.equal(waits.cpu.count, 0);
  });
});
