import { describe, expect, it, vi } from "vitest";
import { upsertNotificationByDedupeKey } from "../src/notification-upsert.js";

describe("upsertNotificationByDedupeKey", () => {
  it("inserts when no existing row and enqueues outbox in same TX", async () => {
    const calls: string[] = [];
    const client = {
      async query(sql: string) {
        const norm = sql.replace(/\s+/g, " ").trim();
        calls.push(norm.split(" ")[0] ?? norm);
        if (norm === "BEGIN" || norm === "COMMIT" || norm === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        if (norm.includes("WHERE dedupe_key") && norm.includes("SELECT")) {
          return { rows: [], rowCount: 0 };
        }
        if (norm.includes("INSERT INTO notification.notifications")) {
          return {
            rows: [
              {
                id: "nid-1",
                read_at: null,
                created_at: new Date("2026-08-10T12:00:00.000Z"),
              },
            ],
            rowCount: 1,
          };
        }
        if (norm.includes("INSERT INTO notification.outbox_events")) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected:${norm.slice(0, 60)}`);
      },
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        const norm = sql.replace(/\s+/g, " ").trim();
        if (norm.includes("WHERE dedupe_key") && norm.includes("SELECT")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`unexpected_pool:${norm.slice(0, 60)}`);
      }),
      connect: async () => client,
    } as import("pg").Pool;

    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { note: "x" },
      dedupeKey: "k1",
    });
    expect(r.inserted).toBe(true);
    expect(r.notificationId).toBe("nid-1");
    expect(r.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(calls).toEqual(["BEGIN", "SELECT", "INSERT", "INSERT", "COMMIT"]);
  });

  it("merges when row exists (no read_at reset, no outbox)", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: "nid-1", read_at: "2020-01-01T00:00:00.000Z" }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
      connect: vi.fn(),
    } as import("pg").Pool;
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { extra: 1 },
      dedupeKey: "k1",
    });
    expect(r.inserted).toBe(false);
    expect(r.notificationId).toBe("nid-1");
    expect(r.readAt).toBe("2020-01-01T00:00:00.000Z");
    expect(r.eventId).toBeNull();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("on unique race after empty SELECT, merges and preserves read_at from row", async () => {
    const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
    const client = {
      async query(sql: string) {
        const norm = sql.replace(/\s+/g, " ").trim();
        if (norm === "BEGIN" || norm === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        if (norm.includes("WHERE dedupe_key") && norm.includes("SELECT")) {
          return { rows: [], rowCount: 0 };
        }
        if (norm.includes("INSERT INTO notification.notifications")) {
          throw dup;
        }
        throw new Error(`unexpected:${norm.slice(0, 60)}`);
      },
      release: vi.fn(),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: "nid-race", read_at: "2019-06-01T12:00:00.000Z" }],
          rowCount: 1,
        }),
      connect: async () => client,
    } as import("pg").Pool;
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { from: "kafka" },
      dedupeKey: "race-key",
    });
    expect(r.inserted).toBe(false);
    expect(r.notificationId).toBe("nid-race");
    expect(r.readAt).toBe("2019-06-01T12:00:00.000Z");
    expect(r.eventId).toBeNull();
  });
});
