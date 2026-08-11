/**
 * Phase B: transactional enqueue — protobuf Record*V1 BYTEA, event_id minted
 * once before Prisma TX, HTTP+gRPC share helpers, no-op PUT short-circuit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  decodeRecordCreatedV1,
  decodeRecordsEventEnvelope,
  encodeRecordCreatedV1,
  encodeRecordDeletedV1,
  encodeRecordUpdatedV1,
  RECORD_CREATED_V1,
  RECORD_DELETED_V1,
  RECORD_UPDATED_V1,
  wrapRecordsOutboxRowAsEventEnvelope,
} from "../src/recordsKafkaEvents.js";
import { insertRecordsOutboxEvent } from "../src/outbox/enqueueOutbox.js";
import {
  createRecordWithOutbox,
  deleteRecordWithOutbox,
  mintRecordsEventId,
  updateRecordWithOutbox,
} from "../src/application/recordOutbox.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const RECORD_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = "2026-08-10T12:00:00.000Z";
const UPDATED_AT = "2026-08-10T12:05:00.000Z";
const DELETED_AT = "2026-08-10T12:10:00.000Z";

type OutboxCall = { sql: string; values: unknown[] };

function sqlFromTemplate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
    "",
  );
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    userId: USER_ID,
    artist: "Artist",
    name: "Album",
    format: "LP",
    catalogNumber: null,
    notes: null,
    mediaPieces: [],
    createdAt: new Date(CREATED_AT),
    updatedAt: new Date(CREATED_AT),
    ...overrides,
  };
}

function makeFakePrisma(opts?: {
  failOn?: "domain" | "outbox" | "commit";
  existing?: Record<string, unknown> | null;
}) {
  const outboxCalls: OutboxCall[] = [];
  const domainCalls: string[] = [];
  let committed = false;
  let rolledBack = false;
  let revisionCreated = false;
  let stored: Record<string, unknown> | null = opts?.existing
    ? { ...opts.existing }
    : null;

  const tx = {
    record: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        domainCalls.push("create");
        if (opts?.failOn === "domain") throw new Error("domain_boom");
        stored = baseRecord({
          ...data,
          id: RECORD_ID,
          userId: data.userId ?? USER_ID,
          createdAt: new Date(CREATED_AT),
          updatedAt: new Date(CREATED_AT),
          mediaPieces: [],
        });
        return stored;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        domainCalls.push("update");
        if (opts?.failOn === "domain") throw new Error("domain_boom");
        stored = {
          ...(stored ?? baseRecord()),
          ...data,
          updatedAt: new Date(UPDATED_AT),
        };
        return stored;
      },
      delete: async () => {
        domainCalls.push("delete");
        if (opts?.failOn === "domain") throw new Error("domain_boom");
        const gone = stored;
        stored = null;
        return gone;
      },
      findUnique: async () => stored,
      findFirst: async () => stored,
    },
    recordRevision: {
      create: async () => {
        domainCalls.push("revision");
        revisionCreated = true;
        return { id: "rev-1" };
      },
      findFirst: async () => null,
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlFromTemplate(strings, values);
      outboxCalls.push({ sql, values });
      if (opts?.failOn === "outbox") throw new Error("outbox_boom");
      return 1;
    },
  };

  const prisma = {
    record: {
      findUnique: async () => stored,
      findFirst: async () => stored,
    },
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      try {
        const result = await fn(tx);
        if (opts?.failOn === "commit") throw new Error("commit_boom");
        committed = true;
        return result;
      } catch (err) {
        rolledBack = true;
        throw err;
      }
    },
  };

  return {
    prisma: prisma as never,
    outboxCalls,
    domainCalls,
    getState: () => ({ committed, rolledBack, revisionCreated, stored }),
  };
}

describe("insertRecordsOutboxEvent", () => {
  it("rejects missing event_id before any SQL", async () => {
    const tx = { $executeRaw: vi.fn() };
    await expect(
      insertRecordsOutboxEvent(tx as never, {
        eventId: "",
        aggregateId: RECORD_ID,
        type: RECORD_CREATED_V1,
        version: 1,
        payload: encodeRecordCreatedV1({
          record_id: RECORD_ID,
          user_id: USER_ID,
          created_at: CREATED_AT,
        }),
      }),
    ).rejects.toThrow(/records_outbox_event_id_missing/);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("createRecordWithOutbox", () => {
  it("E1/E5/E6/E7/E13 same TX, CreatedV1 proto BYTEA, event_id === outbox.id, key=record_id", async () => {
    const { prisma, outboxCalls, domainCalls, getState } = makeFakePrisma();
    const result = await createRecordWithOutbox(prisma, {
      data: { userId: USER_ID, artist: "Artist", name: "Album", format: "LP" },
      eventId: EVENT_ID,
    });

    expect(getState().committed).toBe(true);
    expect(getState().rolledBack).toBe(false);
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.record.id).toBe(RECORD_ID);
    expect(domainCalls).toEqual(["create", "revision"]);

    expect(outboxCalls).toHaveLength(1);
    const sql = outboxCalls[0]!.sql.replace(/\s+/g, " ");
    expect(sql).toMatch(/INSERT INTO records\.outbox_events/);
    expect(outboxCalls[0]!.values[0]).toBe(EVENT_ID);
    expect(outboxCalls[0]!.values[1]).toBe(RECORD_ID);
    expect(outboxCalls[0]!.values[2]).toBe(RECORD_CREATED_V1);
    expect(outboxCalls[0]!.values[3]).toBe(1);
    const payload = outboxCalls[0]!.values[4] as Buffer;
    expect(
      payload.equals(
        encodeRecordCreatedV1({
          record_id: RECORD_ID,
          user_id: USER_ID,
          created_at: CREATED_AT,
        }),
      ),
    ).toBe(true);
    expect(decodeRecordCreatedV1(payload).record_id).toBe(RECORD_ID);

    const wrapped = wrapRecordsOutboxRowAsEventEnvelope({
      id: EVENT_ID,
      aggregate_id: RECORD_ID,
      type: RECORD_CREATED_V1,
      version: 1,
      payload,
    });
    const env = decodeRecordsEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.payload.equals(payload)).toBe(true);
  });

  it("E2 domain failure ⇒ zero outbox", async () => {
    const { prisma, outboxCalls, getState } = makeFakePrisma({ failOn: "domain" });
    await expect(
      createRecordWithOutbox(prisma, {
        data: { userId: USER_ID, artist: "A", name: "N", format: "LP" },
        eventId: EVENT_ID,
      }),
    ).rejects.toThrow(/domain_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(outboxCalls).toHaveLength(0);
  });

  it("E3 outbox failure rolls domain", async () => {
    const { prisma, getState } = makeFakePrisma({ failOn: "outbox" });
    await expect(
      createRecordWithOutbox(prisma, {
        data: { userId: USER_ID, artist: "A", name: "N", format: "LP" },
        eventId: EVENT_ID,
      }),
    ).rejects.toThrow(/outbox_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });

  it("E4 commit failure fail-closed", async () => {
    const { prisma, getState } = makeFakePrisma({ failOn: "commit" });
    await expect(
      createRecordWithOutbox(prisma, {
        data: { userId: USER_ID, artist: "A", name: "N", format: "LP" },
        eventId: EVENT_ID,
      }),
    ).rejects.toThrow(/commit_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });
});

describe("updateRecordWithOutbox", () => {
  it("E13 RecordUpdatedV1 only when a domain mutation occurs", async () => {
    const existing = baseRecord({ artist: "Old" });
    const { prisma, outboxCalls, domainCalls, getState } = makeFakePrisma({
      existing,
    });
    const result = await updateRecordWithOutbox(prisma, {
      id: RECORD_ID,
      userId: USER_ID,
      recordData: { artist: "New" },
      eventId: EVENT_ID,
    });
    expect(result.kind).toBe("updated");
    expect(result.eventId).toBe(EVENT_ID);
    expect(domainCalls).toContain("update");
    expect(domainCalls).toContain("revision");
    expect(getState().committed).toBe(true);
    expect(outboxCalls[0]!.values[2]).toBe(RECORD_UPDATED_V1);
    expect(outboxCalls[0]!.values[1]).toBe(RECORD_ID);
    const payload = outboxCalls[0]!.values[4] as Buffer;
    expect(
      payload.equals(
        encodeRecordUpdatedV1({
          record_id: RECORD_ID,
          user_id: USER_ID,
          updated_at: UPDATED_AT,
        }),
      ),
    ).toBe(true);
  });

  it("no-op PUT: diff.changed.length==0 ⇒ no UPDATE, revision, or outbox", async () => {
    const existing = baseRecord();
    const { prisma, outboxCalls, domainCalls, getState } = makeFakePrisma({
      existing,
    });
    const result = await updateRecordWithOutbox(prisma, {
      id: RECORD_ID,
      userId: USER_ID,
      recordData: { artist: "Artist", name: "Album", format: "LP" },
      eventId: EVENT_ID,
    });
    expect(result.kind).toBe("noop");
    expect(result.eventId).toBeNull();
    expect(domainCalls).not.toContain("update");
    expect(domainCalls).not.toContain("revision");
    expect(outboxCalls).toHaveLength(0);
    expect(getState().committed).toBe(false);
    expect(getState().stored?.updatedAt).toEqual(new Date(CREATED_AT));
  });
});

describe("deleteRecordWithOutbox", () => {
  it("E13 captures record_id/user_id before DELETE; same TX RecordDeletedV1", async () => {
    const existing = baseRecord();
    const { prisma, outboxCalls, domainCalls, getState } = makeFakePrisma({
      existing,
    });
    const result = await deleteRecordWithOutbox(prisma, {
      id: RECORD_ID,
      userId: USER_ID,
      eventId: EVENT_ID,
      deletedAt: DELETED_AT,
    });
    expect(result.kind).toBe("deleted");
    expect(result.eventId).toBe(EVENT_ID);
    expect(domainCalls[0]).toBe("delete");
    expect(getState().committed).toBe(true);
    expect(outboxCalls[0]!.values[0]).toBe(EVENT_ID);
    expect(outboxCalls[0]!.values[1]).toBe(RECORD_ID);
    expect(outboxCalls[0]!.values[2]).toBe(RECORD_DELETED_V1);
    const payload = outboxCalls[0]!.values[4] as Buffer;
    expect(
      payload.equals(
        encodeRecordDeletedV1({
          record_id: RECORD_ID,
          user_id: USER_ID,
          deleted_at: DELETED_AT,
        }),
      ),
    ).toBe(true);
  });
});

describe("identity minting", () => {
  it("mintRecordsEventId is UUID v4; drain source still must not mint", () => {
    expect(mintRecordsEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const drainSrc = readFileSync(join(SRC, "outbox/publishOutbox.ts"), "utf8");
    expect(drainSrc).not.toMatch(/from ["']node:crypto["']/);
    expect(drainSrc).not.toMatch(/crypto\.randomUUID/);
    expect(drainSrc).not.toMatch(/mintRecordsEventId/);
  });
});

describe("E8–E12 / E14 coverage wiring", () => {
  it("E8–E11 HTTP+gRPC write paths use shared helpers", () => {
    const httpTs = readFileSync(join(SRC, "routes/records.ts"), "utf8");
    const grpcTs = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(httpTs).toMatch(/createRecordWithOutbox/);
    expect(httpTs).toMatch(/updateRecordWithOutbox/);
    expect(httpTs).toMatch(/deleteRecordWithOutbox/);
    expect(grpcTs).toMatch(/createRecordWithOutbox/);
    expect(grpcTs).toMatch(/updateRecordWithOutbox/);
    expect(grpcTs).toMatch(/deleteRecordWithOutbox/);
  });

  it("E12 write paths never producer.send Record*", () => {
    const httpTs = readFileSync(join(SRC, "routes/records.ts"), "utf8");
    const grpcTs = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    const appTs = readFileSync(join(SRC, "application/recordOutbox.ts"), "utf8");
    const enqTs = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    expect(httpTs).not.toMatch(/producer\.send/);
    expect(grpcTs).not.toMatch(/producer\.send/);
    expect(appTs).not.toMatch(/producer\.send/);
    expect(enqTs).not.toMatch(/producer\.send/);
  });

  it("E14 kafka_value wraps stored proto; drain does not remint id", () => {
    const payload = encodeRecordCreatedV1({
      record_id: RECORD_ID,
      user_id: USER_ID,
      created_at: CREATED_AT,
    });
    const wrapped = wrapRecordsOutboxRowAsEventEnvelope({
      id: EVENT_ID,
      aggregate_id: RECORD_ID,
      type: RECORD_CREATED_V1,
      version: 1,
      payload,
    });
    expect(wrapped.equals(payload)).toBe(false);
    const env = decodeRecordsEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.payload.equals(payload)).toBe(true);
  });

  it("DDL comment stays proto bytes; not JSON", () => {
    const ddl = readFileSync(join(REPO, "infra/db/01-records-outbox.sql"), "utf8");
    expect(ddl).toMatch(/Serialized domain event \(proto bytes\); not JSON/);
    expect(ddl).not.toMatch(/UTF-8 JSON/);
  });

  it("enqueue uses Prisma \$executeRaw, not a second pool", () => {
    const enqTs = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const appTs = readFileSync(join(SRC, "application/recordOutbox.ts"), "utf8");
    expect(enqTs).toMatch(/\$executeRaw/);
    expect(enqTs).not.toMatch(/from ["']pg["']/);
    expect(appTs).toMatch(/\$transaction/);
    expect(appTs).not.toMatch(/new pg\.Pool/);
  });
});
