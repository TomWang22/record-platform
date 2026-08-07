/**
 * A1.1 — Provenance counter registry + committed-transition semantics (TDD RED).
 *
 * Expected series (acceptance; not aliases of legacy db_ack_total):
 *   auction_monitor_outbox_created_total
 *   auction_monitor_outbox_db_acknowledged_total
 *   auction_monitor_outbox_reopened_total
 *   auction_monitor_outbox_deleted_unpublished_total
 *
 * Increment rules: committed row counts only; never before rollback is still possible;
 * DB-ack requires actualRowCount === expectedRowCount before increment.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { register } from "@common/utils";
import * as metrics from "../outbox-publish-metrics.js";

const PROVENANCE_SERIES = [
  "auction_monitor_outbox_created_total",
  "auction_monitor_outbox_db_acknowledged_total",
  "auction_monitor_outbox_reopened_total",
  "auction_monitor_outbox_deleted_unpublished_total",
] as const;

const COMMITTED_APIS = [
  "incOutboxCreatedCommitted",
  "incOutboxDbAcknowledgedCommitted",
  "incOutboxReopenedCommitted",
  "incOutboxDeletedUnpublishedCommitted",
] as const;

async function counterValue(name: string): Promise<number> {
  const metric = register.getSingleMetric(name);
  expect(metric, `series missing from registry: ${name}`).toBeTruthy();
  const json = await metric!.get();
  const values = json.values ?? [];
  if (values.length === 0) return 0;
  const ok = values.find(
    (v) => !v.labels || Object.keys(v.labels).length === 0 || v.labels.result === "ok",
  );
  return Number((ok ?? values[0]).value);
}

function requireApi<K extends (typeof COMMITTED_APIS)[number]>(name: K): (...args: number[]) => void {
  const fn = (metrics as Record<string, unknown>)[name];
  expect(typeof fn, `missing committed-transition API: ${name}`).toBe("function");
  return fn as (...args: number[]) => void;
}

describe("A1.1 outbox provenance counters", () => {
  beforeAll(() => {
    metrics.registerOutboxPublishMetrics();
  });

  it("exports the four committed-transition APIs", () => {
    for (const name of COMMITTED_APIS) {
      expect(typeof (metrics as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("exports the four exact provenance series and retains legacy db_ack_total", () => {
    const names = metrics.listOutboxMetricNames();
    for (const series of PROVENANCE_SERIES) {
      expect(names, `missing provenance series ${series}`).toContain(series);
    }
    expect(names).toContain("auction_monitor_outbox_db_ack_total");
    expect(PROVENANCE_SERIES).not.toContain("auction_monitor_outbox_db_ack_total");
  });

  it("registers all four provenance series in the Prometheus registry (exportable at zero)", async () => {
    metrics.registerOutboxPublishMetrics();
    const exported = await register.metrics();
    for (const series of PROVENANCE_SERIES) {
      const metric = register.getSingleMetric(series);
      expect(metric, `registry missing ${series}`).toBeTruthy();
      expect(exported, `scrape text missing ${series}`).toContain(series);
      const v = await counterValue(series);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // Legacy labeled counter stays registered for v2 tooling (samples appear after first label use).
    expect(register.getSingleMetric("auction_monitor_outbox_db_ack_total")).toBeTruthy();
    expect(exported).toMatch(/TYPE auction_monitor_outbox_db_ack /);
  });

  it("increments created_total by committed inserted row count only", async () => {
    const inc = requireApi("incOutboxCreatedCommitted");
    const before = await counterValue("auction_monitor_outbox_created_total");
    inc(3);
    expect(await counterValue("auction_monitor_outbox_created_total")).toBe(before + 3);
    inc(0);
    expect(await counterValue("auction_monitor_outbox_created_total")).toBe(before + 3);
  });

  it("increments db_acknowledged_total only when rowCount === expected (committed transition)", async () => {
    const inc = requireApi("incOutboxDbAcknowledgedCommitted");
    const before = await counterValue("auction_monitor_outbox_db_acknowledged_total");

    expect(() => inc(2, 1)).toThrow(/rowCount|expected|committed/i);
    expect(await counterValue("auction_monitor_outbox_db_acknowledged_total")).toBe(before);

    inc(2, 2);
    expect(await counterValue("auction_monitor_outbox_db_acknowledged_total")).toBe(before + 2);
  });

  it("registers reopened and deleted series without synthesizing increments", async () => {
    const incReopened = requireApi("incOutboxReopenedCommitted");
    const incDeleted = requireApi("incOutboxDeletedUnpublishedCommitted");
    const reopenedBefore = await counterValue("auction_monitor_outbox_reopened_total");
    const deletedBefore = await counterValue("auction_monitor_outbox_deleted_unpublished_total");

    incReopened(0);
    incDeleted(0);
    expect(await counterValue("auction_monitor_outbox_reopened_total")).toBe(reopenedBefore);
    expect(await counterValue("auction_monitor_outbox_deleted_unpublished_total")).toBe(deletedBefore);

    incReopened(1);
    incDeleted(1);
    expect(await counterValue("auction_monitor_outbox_reopened_total")).toBe(reopenedBefore + 1);
    expect(await counterValue("auction_monitor_outbox_deleted_unpublished_total")).toBe(
      deletedBefore + 1,
    );
  });

  it("rejects non-finite or negative committed counts", () => {
    const incCreated = requireApi("incOutboxCreatedCommitted");
    const incDb = requireApi("incOutboxDbAcknowledgedCommitted");
    const incReopened = requireApi("incOutboxReopenedCommitted");
    const incDeleted = requireApi("incOutboxDeletedUnpublishedCommitted");

    expect(() => incCreated(-1)).toThrow();
    expect(() => incCreated(Number.NaN)).toThrow();
    expect(() => incDb(1, -1)).toThrow();
    expect(() => incReopened(-1)).toThrow();
    expect(() => incDeleted(Number.POSITIVE_INFINITY)).toThrow();
  });
});
