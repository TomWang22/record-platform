/**
 * A1.1 wiring: COMMIT-gated created_total and rowCount-gated db acknowledgment.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { Pool, PoolClient } from "pg";
import { register } from "@common/utils";
import * as metrics from "../outbox-publish-metrics.js";
import {
  applyOutboxPublishedTrueTransition,
  scanAndPersistAuctionSignals,
} from "../ai-signals.js";

async function counterValue(name: string, labels?: Record<string, string>): Promise<number> {
  const metric = register.getSingleMetric(name);
  expect(metric, `series missing: ${name}`).toBeTruthy();
  const json = await metric!.get();
  const values = json.values ?? [];
  if (values.length === 0) return 0;
  if (!labels) {
    const unlabeled = values.find((v) => !v.labels || Object.keys(v.labels).length === 0);
    return Number((unlabeled ?? values[0]).value);
  }
  const match = values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels?.[k] === val),
  );
  return Number((match ?? { value: 0 }).value);
}

describe("A1.1 committed-transition wiring", () => {
  beforeAll(() => {
    metrics.listOutboxMetricNames();
  });

  it("does not increment created_total when COMMIT fails after outbox insert", async () => {
    const before = await counterValue("auction_monitor_outbox_created_total");

    const listingsPool = {
      query: async () => ({
        rows: [
          {
            listing_id: "11111111-1111-4111-8111-111111111111",
            bid_count: 0,
            current_bid_cents: 100,
            reserve_met: false,
            ends_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            seller_user_id: "22222222-2222-4222-8222-222222222222",
            proxy_bidders: 0,
          },
        ],
      }),
    } as unknown as Pool;

    let sawOutboxInsert = false;
    const client = {
      query: async (sql: string) => {
        const text = String(sql);
        if (text === "BEGIN") return { rowCount: 0, rows: [] };
        if (text.includes("INSERT INTO auction_monitor.ai_signals")) {
          return { rowCount: 1, rows: [{ id: "sig-1" }] };
        }
        if (text.includes("INSERT INTO auction_monitor.outbox_events")) {
          sawOutboxInsert = true;
          return { rowCount: 1, rows: [{ id: "outbox-1" }] };
        }
        if (text === "COMMIT") {
          throw new Error("commit_failed_for_provenance_test");
        }
        if (text === "ROLLBACK") return { rowCount: 0, rows: [] };
        return { rowCount: 0, rows: [] };
      },
      release: () => undefined,
    } as unknown as PoolClient;

    const auctionPool = {
      connect: async () => client,
    } as unknown as Pool;

    await expect(scanAndPersistAuctionSignals(listingsPool, auctionPool)).rejects.toThrow(
      /commit_failed_for_provenance_test/,
    );
    expect(sawOutboxInsert).toBe(true);
    expect(await counterValue("auction_monitor_outbox_created_total")).toBe(before);
  });

  it("rowCount=0 leaves provenance and legacy acknowledgment counters unchanged", async () => {
    const beforeProvenance = await counterValue("auction_monitor_outbox_db_acknowledged_total");
    const beforeLegacy = await counterValue("auction_monitor_outbox_db_ack_total", {
      result: "ok",
    });

    let outboxUpdateSeen = false;
    const auctionPool = {
      query: async (sql: string) => {
        const text = String(sql);
        if (text.includes("UPDATE auction_monitor.outbox_events SET published = true")) {
          outboxUpdateSeen = true;
          return { rowCount: 0, rows: [] };
        }
        if (text.includes("UPDATE auction_monitor.ai_signals")) {
          throw new Error("ai_signals update must not run after failed outbox transition");
        }
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Pool;

    await expect(
      applyOutboxPublishedTrueTransition(
        auctionPool,
        "33333333-3333-4333-8333-333333333333",
      ),
    ).rejects.toThrow(/rowCount mismatch|actual=0 expected=1/i);

    expect(outboxUpdateSeen).toBe(true);
    // Publish path only increments legacy db_ack after provenance validation succeeds.
    expect(await counterValue("auction_monitor_outbox_db_acknowledged_total")).toBe(
      beforeProvenance,
    );
    expect(
      await counterValue("auction_monitor_outbox_db_ack_total", { result: "ok" }),
    ).toBe(beforeLegacy);
  });
});
