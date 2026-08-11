/**
 * Phase B: transactional create enqueue — UTF-8 JSON, NotificationCreatedV1,
 * event_id === outbox.id, dedupe/self-emit/missing-id gates.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTIFICATION_CREATED_V1,
  NOTIFICATION_PRODUCER,
  buildNotificationMetadata,
  isSelfEmittedNotificationCreated,
  parseNotificationEnvelope,
  serializeNotificationEvent,
} from "../src/notificationKafkaEvents.js";
import { insertNotificationOutboxEvent } from "../src/outbox/enqueueOutbox.js";
import { createNotificationWithOutbox } from "../src/application/notificationOutbox.js";
import { upsertNotificationByDedupeKey } from "../src/notification-upsert.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

type QueryCall = { sql: string; params: unknown[] };

function makeFakePool(opts?: {
  failOn?: "domain" | "outbox" | "commit";
  domainRow?: Record<string, unknown>;
}) {
  const calls: QueryCall[] = [];
  let inTx = false;
  let committed = false;
  let rolledBack = false;
  const domainRow = opts?.domainRow ?? {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    event_type: "booking.created",
    created_at: new Date("2026-08-10T12:00:00.000Z"),
  };

  const client = {
    async query(sql: string, params: unknown[] = []) {
      const norm = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: norm, params });
      if (norm === "BEGIN") {
        inTx = true;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "COMMIT") {
        if (opts?.failOn === "commit") {
          throw new Error("commit_boom");
        }
        committed = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "ROLLBACK") {
        rolledBack = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO notification.notifications")) {
        if (opts?.failOn === "domain") {
          throw new Error("domain_boom");
        }
        return { rows: [domainRow], rowCount: 1 };
      }
      if (norm.includes("INSERT INTO notification.outbox_events")) {
        if (opts?.failOn === "outbox") {
          throw new Error("outbox_boom");
        }
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected_sql:${norm.slice(0, 80)}`);
    },
    release: vi.fn(),
  };

  const pool = {
    connect: async () => client,
    query: async () => {
      throw new Error("bare_pool_query_forbidden_in_phase_b_helper");
    },
  };

  return { pool: pool as never, calls, getState: () => ({ inTx, committed, rolledBack }) };
}

describe("serializeNotificationEvent / buildNotificationMetadata", () => {
  it("E6 serializes exact UTF-8 JSON bytes", () => {
    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const metadata = buildNotificationMetadata({
      event_id: eventId,
      event_type: "NotificationCreated",
      aggregate_id: "n1",
    });
    expect(metadata.event_id).toBe(eventId);
    expect(metadata.producer).toBe(NOTIFICATION_PRODUCER);
    const payload = { metadata, notification_id: "n1" };
    const buf = serializeNotificationEvent(payload);
    expect(buf.equals(Buffer.from(JSON.stringify(payload), "utf8"))).toBe(true);
  });
});

describe("insertNotificationOutboxEvent", () => {
  it("rejects identity mismatch", async () => {
    const client = { query: vi.fn() };
    await expect(
      insertNotificationOutboxEvent(client as never, {
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        partitionKey: "k",
        type: NOTIFICATION_CREATED_V1,
        version: 1,
        payload: {
          metadata: {
            event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            event_type: "NotificationCreated",
            aggregate_id: "n",
            aggregate_type: "notification",
            producer: NOTIFICATION_PRODUCER,
          },
        },
      }),
    ).rejects.toThrow(/notification_outbox_identity_mismatch/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("createNotificationWithOutbox", () => {
  it("E1/E5/E7/E13 happy path: same TX, CreatedV1, event_id === outbox id, key=notification_id", async () => {
    const { pool, calls, getState } = makeFakePool();
    const result = await createNotificationWithOutbox(pool, {
      userId: "22222222-2222-4222-8222-222222222222",
      eventType: "booking.created",
      payload: { booking_id: "b1" },
    });

    expect(getState().committed).toBe(true);
    expect(getState().rolledBack).toBe(false);
    expect(result.partitionKey).toBe(result.notification.id);
    expect(result.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const outbox = calls.find((c) =>
      c.sql.includes("INSERT INTO notification.outbox_events"),
    );
    expect(outbox).toBeTruthy();
    expect(outbox!.params[0]).toBe(result.eventId);
    expect(outbox!.params[1]).toBe(result.notification.id);
    expect(outbox!.params[2]).toBe(NOTIFICATION_CREATED_V1);
    expect(outbox!.params[3]).toBe(1);
    const payloadBuf = outbox!.params[4] as Buffer;
    const parsed = JSON.parse(payloadBuf.toString("utf8")) as {
      metadata: { event_id: string; event_type: string };
    };
    expect(parsed.metadata.event_id).toBe(result.eventId);
    expect(String(outbox!.params[2])).not.toBe("NotificationSentV1");
    expect(
      payloadBuf.equals(Buffer.from(JSON.stringify(parsed), "utf8")),
    ).toBe(true);

    expect(calls.map((c) => c.sql.split(" ")[0])).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
  });

  it("E2 domain failure ⇒ zero outbox", async () => {
    const { pool, calls, getState } = makeFakePool({ failOn: "domain" });
    await expect(
      createNotificationWithOutbox(pool, {
        userId: "22222222-2222-4222-8222-222222222222",
        eventType: "booking.created",
        payload: {},
      }),
    ).rejects.toThrow(/domain_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO notification.outbox_events")),
    ).toHaveLength(0);
  });

  it("E3 outbox failure rolls domain", async () => {
    const { pool, getState } = makeFakePool({ failOn: "outbox" });
    await expect(
      createNotificationWithOutbox(pool, {
        userId: "22222222-2222-4222-8222-222222222222",
        eventType: "booking.created",
        payload: {},
      }),
    ).rejects.toThrow(/outbox_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });

  it("E4 commit failure fail-closed", async () => {
    const { pool, getState } = makeFakePool({ failOn: "commit" });
    await expect(
      createNotificationWithOutbox(pool, {
        userId: "22222222-2222-4222-8222-222222222222",
        eventType: "booking.created",
        payload: {},
      }),
    ).rejects.toThrow(/commit_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });
});

describe("E12 dedupe_hit_no_second_outbox", () => {
  it("inserted=false ⇒ zero event_id minted, zero outbox inserts", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: "nid-1", read_at: "2020-01-01T00:00:00.000Z" }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
      connect: vi.fn(),
    } as never;
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { extra: 1 },
      dedupeKey: "k1",
    });
    expect(r.inserted).toBe(false);
    expect(r.eventId).toBeNull();
    expect((pool as { connect: ReturnType<typeof vi.fn> }).connect).not.toHaveBeenCalled();
    const sqls = (pool as { query: ReturnType<typeof vi.fn> }).query.mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    expect(sqls.some((s: string) => s.includes("outbox_events"))).toBe(false);
  });
});

describe("E14/E15 decoder + self-emit", () => {
  it("E15 parseNotificationEnvelope never randomUUID on missing id", () => {
    const buf = Buffer.from(
      JSON.stringify({
        metadata: { event_type: "NotificationCreated", producer: "other" },
        payload: {},
      }),
      "utf8",
    );
    const parsed = parseNotificationEnvelope(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.missingEventId).toBe(true);
    expect(parsed!.eventId).toBeNull();
  });

  it("E14 self_emit requires producer + NotificationCreatedV1", () => {
    expect(
      isSelfEmittedNotificationCreated({
        producer: NOTIFICATION_PRODUCER,
        eventType: NOTIFICATION_CREATED_V1,
      }),
    ).toBe(true);
    expect(
      isSelfEmittedNotificationCreated({
        producer: "foreign-producer",
        eventType: NOTIFICATION_CREATED_V1,
      }),
    ).toBe(false);
    expect(
      isSelfEmittedNotificationCreated({
        producer: NOTIFICATION_PRODUCER,
        eventType: "BookingRequestV1",
      }),
    ).toBe(false);
  });
});

describe("coverage wiring (E8–E10)", () => {
  it("E8/E9 create paths reference shared helper; E10 no producer.send on create modules", () => {
    const httpTs = readFileSync(
      join(REPO, "services/notification-service/src/http-server.ts"),
      "utf8",
    );
    const kafkaTs = readFileSync(
      join(REPO, "services/notification-service/src/kafka-consumer.ts"),
      "utf8",
    );
    const upsertTs = readFileSync(
      join(REPO, "services/notification-service/src/notification-upsert.ts"),
      "utf8",
    );
    expect(httpTs).toMatch(/createNotificationWithOutbox/);
    expect(kafkaTs).toMatch(/createNotificationWithOutbox/);
    expect(upsertTs).toMatch(/enqueueNotificationCreatedOnClient/);
    expect(httpTs).not.toMatch(/producer\.send/);
    expect(upsertTs).not.toMatch(/producer\.send/);
  });

  it("DDL comment freezes UTF-8 JSON / Created semantics", () => {
    const ddl = readFileSync(join(REPO, "infra/db/03-notification-outbox.sql"), "utf8");
    expect(ddl).toMatch(/UTF-8 JSON/);
    expect(ddl).toMatch(/NotificationCreatedV1/);
    expect(ddl).not.toMatch(/protobuf EventEnvelope/);
  });
});
