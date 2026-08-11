/**
 * Phase B: transactional create/reply enqueue — same PoolClient for domain + outbox.
 * Covered paths must not call sendMessagingEvent.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMetadata,
  serializeMessagingEvent,
} from "../src/kafkaMessagingEvents.js";
import { insertMessagingOutboxEvent } from "../src/outbox/enqueueOutbox.js";
import {
  createMessageWithOutbox,
  replyMessageWithOutbox,
} from "../src/application/messageOutbox.js";

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
    sender_id: "22222222-2222-4222-8222-222222222222",
    recipient_id: "33333333-3333-4333-8333-333333333333",
    group_id: null,
    parent_message_id: null,
    thread_id: "44444444-4444-4444-8444-444444444444",
    message_type: "General",
    subject: "hi",
    content: "body",
    created_at: new Date("2026-08-10T12:00:00.000Z"),
    updated_at: new Date("2026-08-10T12:00:00.000Z"),
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
      if (norm.includes("INSERT INTO messages.messages")) {
        if (opts?.failOn === "domain") {
          throw new Error("domain_boom");
        }
        return { rows: [domainRow], rowCount: 1 };
      }
      if (norm.includes("INSERT INTO messaging.outbox_events")) {
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

describe("serializeMessagingEvent / buildMetadata", () => {
  it("mints optional event_id and serializes UTF-8 JSON", () => {
    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const metadata = buildMetadata({
      event_id: eventId,
      event_type: "MessageSent",
      aggregate_id: "m1",
      aggregate_type: "message",
    });
    expect(metadata.event_id).toBe(eventId);
    const payload = { metadata, message_id: "m1" };
    const buf = serializeMessagingEvent(payload);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.equals(Buffer.from(JSON.stringify(payload), "utf8"))).toBe(true);
  });
});

describe("insertMessagingOutboxEvent", () => {
  it("rejects identity mismatch", async () => {
    const client = {
      query: vi.fn(),
    };
    await expect(
      insertMessagingOutboxEvent(client as never, {
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        partitionKey: "k",
        type: "MessageSentV1",
        version: 1,
        payload: {
          metadata: {
            event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            event_type: "MessageSent",
            aggregate_id: "m",
            aggregate_type: "message",
          },
        },
      }),
    ).rejects.toThrow(/messaging_outbox_identity_mismatch/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("createMessageWithOutbox / replyMessageWithOutbox", () => {
  it("happy path: same TX, event_id === outbox id, UTF-8 payload bytes", async () => {
    const { pool, calls, getState } = makeFakePool();
    const result = await createMessageWithOutbox(pool, {
      senderId: "22222222-2222-4222-8222-222222222222",
      recipientId: "33333333-3333-4333-8333-333333333333",
      groupId: null,
      parentMessageId: null,
      threadId: "44444444-4444-4444-8444-444444444444",
      messageType: "General",
      subject: "hi",
      content: "body",
      partitionKey: (row) =>
        String(row.group_id || row.recipient_id || row.id),
    });

    expect(getState().committed).toBe(true);
    expect(getState().rolledBack).toBe(false);
    expect(result.partitionKey).toBe("33333333-3333-4333-8333-333333333333");
    expect(result.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const outbox = calls.find((c) =>
      c.sql.includes("INSERT INTO messaging.outbox_events"),
    );
    expect(outbox).toBeTruthy();
    expect(outbox!.params[0]).toBe(result.eventId);
    expect(outbox!.params[1]).toBe(result.partitionKey);
    expect(outbox!.params[2]).toBe("MessageSentV1");
    expect(outbox!.params[3]).toBe(1);
    const payloadBuf = outbox!.params[4] as Buffer;
    const parsed = JSON.parse(payloadBuf.toString("utf8")) as {
      metadata: { event_id: string; event_type: string };
    };
    expect(parsed.metadata.event_id).toBe(result.eventId);
    expect(parsed.metadata.event_type).toBe("MessageSent");
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

  it("reply path uses MessageRepliedV1 and preserves partition key", async () => {
    const parentId = "55555555-5555-4555-8555-555555555555";
    const { pool, calls } = makeFakePool({
      domainRow: {
        id: "66666666-6666-4666-8666-666666666666",
        sender_id: "22222222-2222-4222-8222-222222222222",
        recipient_id: "33333333-3333-4333-8333-333333333333",
        group_id: null,
        parent_message_id: parentId,
        thread_id: "44444444-4444-4444-8444-444444444444",
        message_type: "General",
        subject: "",
        content: "reply",
        created_at: new Date("2026-08-10T12:00:00.000Z"),
        updated_at: new Date("2026-08-10T12:00:00.000Z"),
      },
    });
    const result = await replyMessageWithOutbox(pool, {
      senderId: "22222222-2222-4222-8222-222222222222",
      recipientId: "33333333-3333-4333-8333-333333333333",
      groupId: null,
      parentMessageId: parentId,
      threadId: "44444444-4444-4444-8444-444444444444",
      messageType: "General",
      subject: "",
      content: "reply",
      partitionKey: parentId,
    });
    expect(result.partitionKey).toBe(parentId);
    const outbox = calls.find((c) =>
      c.sql.includes("INSERT INTO messaging.outbox_events"),
    )!;
    expect(outbox.params[1]).toBe(parentId);
    expect(outbox.params[2]).toBe("MessageRepliedV1");
    const parsed = JSON.parse((outbox.params[4] as Buffer).toString("utf8"));
    expect(parsed.metadata.event_type).toBe("MessageReplied");
    expect(parsed.metadata.event_id).toBe(result.eventId);
  });

  it("domain failure => zero outbox rows + rollback", async () => {
    const { pool, calls, getState } = makeFakePool({ failOn: "domain" });
    await expect(
      createMessageWithOutbox(pool, {
        senderId: "s",
        recipientId: "r",
        groupId: null,
        parentMessageId: null,
        threadId: null,
        messageType: "General",
        subject: "s",
        content: "c",
        partitionKey: "r",
      }),
    ).rejects.toThrow(/domain_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
    expect(
      calls.some((c) => c.sql.includes("INSERT INTO messaging.outbox_events")),
    ).toBe(false);
  });

  it("outbox failure => domain mutation rolled back", async () => {
    const { pool, getState } = makeFakePool({ failOn: "outbox" });
    await expect(
      createMessageWithOutbox(pool, {
        senderId: "s",
        recipientId: "r",
        groupId: null,
        parentMessageId: null,
        threadId: null,
        messageType: "General",
        subject: "s",
        content: "c",
        partitionKey: "r",
      }),
    ).rejects.toThrow(/outbox_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });

  it("COMMIT failure => request fails closed", async () => {
    const { pool, getState } = makeFakePool({ failOn: "commit" });
    await expect(
      createMessageWithOutbox(pool, {
        senderId: "s",
        recipientId: "r",
        groupId: null,
        parentMessageId: null,
        threadId: null,
        messageType: "General",
        subject: "s",
        content: "c",
        partitionKey: "r",
      }),
    ).rejects.toThrow(/commit_boom/);
    expect(getState().committed).toBe(false);
    expect(getState().rolledBack).toBe(true);
  });
});

describe("Phase B no-direct-produce regression gate", () => {
  it("HTTP create/reply and gRPC Send/Reply do not call sendMessagingEvent", () => {
    const messagesTs = readFileSync(
      join(REPO, "services/messaging-service/src/routes/messages.ts"),
      "utf8",
    );
    const grpcTs = readFileSync(
      join(REPO, "services/messaging-service/src/grpc-server.ts"),
      "utf8",
    );

    expect(messagesTs).toMatch(/createMessageWithOutbox/);
    expect(messagesTs).toMatch(/replyMessageWithOutbox/);
    expect(grpcTs).toMatch(/createMessageWithOutbox/);
    expect(grpcTs).toMatch(/replyMessageWithOutbox/);

    // Covered event types must not be direct-produced from these modules.
    expect(messagesTs).not.toMatch(/event_type:\s*['"]MessageSent['"]/);
    expect(messagesTs).not.toMatch(/event_type:\s*['"]MessageReplied['"]/);
    expect(grpcTs).not.toMatch(/event_type:\s*['"]MessageSent['"]/);
    expect(grpcTs).not.toMatch(/event_type:\s*['"]MessageReplied['"]/);

    // Debt: update/delete/read may still direct-produce.
    expect(messagesTs).toMatch(/sendMessagingEvent/);
    expect(grpcTs).toMatch(/sendMessagingEvent/);
  });
});
