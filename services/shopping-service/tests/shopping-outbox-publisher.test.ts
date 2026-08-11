/**
 * X2 first: EventEnvelope identity + timestamp must come from the outbox row.
 * Drain must not mint event_id or wall-clock timestamp.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CART_UPDATED_V1,
  SHOPPING_PRODUCER,
  decodeCartUpdatedV1,
  decodeShoppingEventEnvelope,
  encodeCartUpdatedV1,
  wrapShoppingOutboxRowAsEventEnvelope,
} from "../src/shoppingKafkaEvents.js";
import {
  shoppingEventsTopic,
  isShoppingOutboxPublisherEnabled,
  runShoppingOutboxPublisherTickWithDeps,
  runShoppingOutboxPublisherTickLocked,
  publishShoppingOutboxTick,
  startShoppingOutboxPublisher,
  classifyCommitReconciliation,
  __resetShoppingOutboxSoftFailuresForTests,
  __getShoppingOutboxSoftFailureCountForTests,
  type ShoppingOutboxRow,
  type ShoppingPublisherTickResult,
} from "../src/outbox/publishOutbox.js";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATED_AT = "2026-08-10T12:00:00.000Z";
const CART_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

const DOMAIN_PAYLOAD = encodeCartUpdatedV1({
  user_id: USER_ID,
  cart_item_id: CART_ITEM_ID,
  item_type: "listing",
  item_id: ITEM_ID,
  updated_at: CREATED_AT,
});

const ROW: ShoppingOutboxRow = {
  id: EVENT_ID,
  aggregate_id: USER_ID,
  type: CART_UPDATED_V1,
  version: 1,
  payload: DOMAIN_PAYLOAD,
  created_at: CREATED_AT,
};

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    claimBatch: vi.fn().mockResolvedValue([ROW]),
    sendToKafka: vi.fn().mockResolvedValue(undefined),
    markPublished: vi.fn().mockResolvedValue(1),
    maxAttemptsBeforeExhaustion: 3,
    getFailureCount: vi.fn().mockResolvedValue(0),
    recordFailure: vi.fn().mockResolvedValue(1),
    classifySendError: vi.fn().mockReturnValue("broker_unavailable" as const),
    ...overrides,
  };
}

describe("X2 EventEnvelope identity and timestamp preserved", () => {
  it("maps outbox id/type/version/aggregate_id/created_at exactly; payload bytes unchanged", () => {
    const wrapped = wrapShoppingOutboxRowAsEventEnvelope(ROW);
    expect(wrapped.equals(ROW.payload)).toBe(false);
    const env = decodeShoppingEventEnvelope(wrapped);
    expect(env.event_id).toBe(ROW.id);
    expect(env.type).toBe(ROW.type);
    expect(env.version).toBe(ROW.version);
    expect(env.source).toBe(SHOPPING_PRODUCER);
    expect(env.entity_id).toBe(ROW.aggregate_id);
    expect(env.timestamp).toBe(ROW.created_at);
    expect(env.payload.equals(ROW.payload)).toBe(true);
    expect(decodeCartUpdatedV1(env.payload)).toEqual({
      user_id: USER_ID,
      cart_item_id: CART_ITEM_ID,
      item_type: "listing",
      item_id: ITEM_ID,
      updated_at: CREATED_AT,
    });
  });

  it("serializes Date created_at without minting a new wall-clock", () => {
    const frozen = new Date(CREATED_AT);
    const wrapped = wrapShoppingOutboxRowAsEventEnvelope({
      ...ROW,
      created_at: frozen,
    });
    const env = decodeShoppingEventEnvelope(wrapped);
    expect(env.timestamp).toBe(frozen.toISOString());
    expect(env.timestamp).toBe(CREATED_AT);
  });

  it("refuses to mint event_id when outbox.id is missing", () => {
    expect(() =>
      wrapShoppingOutboxRowAsEventEnvelope({ ...ROW, id: "" }),
    ).toThrow(/shopping_outbox_event_id_missing/);
  });

  it("refuses to mint timestamp when outbox.created_at is missing", () => {
    expect(() =>
      wrapShoppingOutboxRowAsEventEnvelope({ ...ROW, created_at: "" }),
    ).toThrow(/shopping_outbox_created_at_missing/);
  });
});

describe("shopping outbox publisher Phase A (mocked Kafka; shopping stays blocked)", () => {
  const prevEnv = process.env.SHOPPING_OUTBOX_PUBLISHER;
  const prevPrefix = process.env.ENV_PREFIX;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetShoppingOutboxSoftFailuresForTests();
    delete process.env.SHOPPING_OUTBOX_PUBLISHER;
    process.env.ENV_PREFIX = "dev";
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.SHOPPING_OUTBOX_PUBLISHER;
    else process.env.SHOPPING_OUTBOX_PUBLISHER = prevEnv;
    if (prevPrefix === undefined) delete process.env.ENV_PREFIX;
    else process.env.ENV_PREFIX = prevPrefix;
  });

  it("S11 default-off: only ===1 enables", () => {
    delete process.env.SHOPPING_OUTBOX_PUBLISHER;
    expect(isShoppingOutboxPublisherEnabled()).toBe(false);
    process.env.SHOPPING_OUTBOX_PUBLISHER = "0";
    expect(isShoppingOutboxPublisherEnabled()).toBe(false);
    process.env.SHOPPING_OUTBOX_PUBLISHER = "true";
    expect(isShoppingOutboxPublisherEnabled()).toBe(false);
    process.env.SHOPPING_OUTBOX_PUBLISHER = "1";
    expect(isShoppingOutboxPublisherEnabled()).toBe(true);
  });

  it("S11 default-off: start + tick no-op when unset", async () => {
    delete process.env.SHOPPING_OUTBOX_PUBLISHER;
    expect(startShoppingOutboxPublisher({} as never)).toBeNull();
    const result = await publishShoppingOutboxTick({ connect: vi.fn() } as never);
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, dispositions: [] });
  });

  it("S1 happy_path: topic ${ENV_PREFIX}.shopping.events; key=aggregate_id; kafka_value=EventEnvelope", async () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const drainSrc =
      readFileSync(join(srcDir, "outbox/publishOutbox.ts"), "utf8") +
      readFileSync(join(srcDir, "shoppingKafkaEvents.ts"), "utf8");
    expect(drainSrc).not.toMatch(/from ["']node:crypto["']/);
    expect(drainSrc).not.toMatch(/crypto\.randomUUID/);
    expect(drainSrc).not.toMatch(/new Date\s*\(\s*\)/);

    const deps = baseDeps();
    const result = await runShoppingOutboxPublisherTickWithDeps(deps);
    expect(shoppingEventsTopic()).toBe("dev.shopping.events");
    expect(deps.sendToKafka).toHaveBeenCalledTimes(1);
    const [topic, key, value] = deps.sendToKafka.mock.calls[0] as [string, string, Buffer];
    expect(topic).toBe(shoppingEventsTopic());
    expect(key).toBe(USER_ID);
    expect(value.equals(DOMAIN_PAYLOAD)).toBe(false);
    const env = decodeShoppingEventEnvelope(value);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.type).toBe(CART_UPDATED_V1);
    expect(env.version).toBe(1);
    expect(env.source).toBe(SHOPPING_PRODUCER);
    expect(env.entity_id).toBe(USER_ID);
    expect(env.timestamp).toBe(CREATED_AT);
    expect(env.payload.equals(DOMAIN_PAYLOAD)).toBe(true);
    expect(deps.markPublished).toHaveBeenCalledWith(EVENT_ID);
    expect(result.published).toBe(1);
  });

  it("X1 drain SQL targets shopping.outbox_events only", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const drainSrc = readFileSync(join(srcDir, "outbox/publishOutbox.ts"), "utf8");
    expect(drainSrc).toMatch(/FROM shopping\.outbox_events/);
    expect(drainSrc).toMatch(/UPDATE shopping\.outbox_events SET published = true/);
    expect(drainSrc).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(drainSrc).not.toMatch(/FROM listings\.outbox_events/);
    expect(drainSrc).not.toMatch(/INTO listings\.outbox_events/);
    expect(drainSrc).not.toMatch(/UPDATE listings\.outbox_events/);
    expect(drainSrc).not.toMatch(/lease_outbox_batch/);
    expect(drainSrc).not.toMatch(/type\s*=\s*['"]SaleCompleted['"]/);
  });

  it("S2 empty_claim", async () => {
    const deps = baseDeps({ claimBatch: vi.fn().mockResolvedValue([]) });
    const result = await runShoppingOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it("S3 broker_unavailable: never marks", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
    });
    const result = await runShoppingOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "broker_unavailable" }]);
  });

  it("S4 restart_after_selection then recover", async () => {
    const a = await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("publisher_restart_after_selection")),
        classifySendError: vi.fn().mockReturnValue("publisher_restart_after_selection" as const),
      }),
    );
    expect(a.dispositions[0]?.outcome).toBe("publisher_restart_after_selection");
    const b = await runShoppingOutboxPublisherTickWithDeps(baseDeps());
    expect(b.published).toBe(1);
  });

  it("S5 broker_ack_without_db_ack: rowCount=0 not published", async () => {
    const result = await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({ markPublished: vi.fn().mockResolvedValue(0) }),
    );
    expect(result.published).toBe(0);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
  });

  it("S6 duplicate_delivery: second success path still marks once", async () => {
    const first = await runShoppingOutboxPublisherTickWithDeps(baseDeps());
    expect(first.published).toBe(1);
    const second = await runShoppingOutboxPublisherTickWithDeps(baseDeps());
    expect(second.published).toBe(1);
    expect(second.dispositions).toEqual([{ id: ROW.id, outcome: "published" }]);
  });

  it("S7 poison_event", async () => {
    const result = await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("poison")),
        classifySendError: vi.fn().mockReturnValue("poison_event" as const),
      }),
    );
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "poison_event" }]);
  });

  it("S8 retry_exhaustion process-scoped across ticks", async () => {
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    let last: ShoppingPublisherTickResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await runShoppingOutboxPublisherTickWithDeps(
        baseDeps({
          sendToKafka,
          getFailureCount: undefined,
          recordFailure: undefined,
          maxAttemptsBeforeExhaustion: 3,
        }),
      );
    }
    expect(last?.dispositions).toEqual([{ id: ROW.id, outcome: "retry_exhaustion" }]);
  });

  it("S9 ordering send then mark", async () => {
    const order: string[] = [];
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockImplementation(async () => {
          order.push("send");
        }),
        markPublished: vi.fn().mockImplementation(async () => {
          order.push("mark");
          return 1;
        }),
      }),
    );
    expect(order).toEqual(["send", "mark"]);
  });

  it("S10 batch failure rolls back all DB marks; broker-acked rows may duplicate on retry", async () => {
    const row2: ShoppingOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "55555555-5555-4555-8555-555555555555",
    };
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW, row2];
      },
      sendToKafka: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push("send1");
        })
        .mockImplementationOnce(async () => {
          order.push("send2");
          throw new Error("broker down");
        }),
      markPublished: vi.fn().mockImplementation(async (id: string) => {
        order.push(`mark:${id}`);
        return 1;
      }),
      commit: async () => {
        order.push("commit");
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual(["begin", "send1", `mark:${ROW.id}`, "send2", "rollback"]);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("S12 claim failure rolls back without send", async () => {
    const order: string[] = [];
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        throw new Error("claim failed");
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => 1,
      commit: async () => {
        order.push("commit");
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual(["begin", "rollback"]);
    expect(result.published).toBe(0);
  });

  it("G3 soft failures clear only after successful COMMIT", async () => {
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => {
        order.push("mark");
        expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
        return 1;
      },
      commit: async () => {
        order.push("commit");
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual(["begin", "send", "mark", "commit"]);
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G5 COMMIT throw without reconcile: outcome unknown; soft failures retained", async () => {
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => {
        order.push("mark");
        return 1;
      },
      commit: async () => {
        order.push("commit");
        throw new Error("commit failed");
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual(["begin", "send", "mark", "commit", "rollback"]);
    expect(result.commit_outcome).toBe("unknown_pending_reconciliation");
    expect(result.unknowns).toBe(1);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "commit_outcome_unknown" },
    ]);
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("G6 COMMIT throw: rollback invoked; not proof of unpublished", async () => {
    const row2: ShoppingOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "55555555-5555-4555-8555-555555555555",
    };
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        claimBatch: vi.fn().mockResolvedValue([row2]),
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getShoppingOutboxSoftFailureCountForTests(row2.id)).toBe(1);

    const order: string[] = [];
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW, row2];
      },
      sendToKafka: async (_t, key) => {
        order.push(`send:${key}`);
      },
      markPublished: async (id) => {
        order.push(`mark:${id}`);
        return 1;
      },
      commit: async () => {
        order.push("commit");
        throw new Error("commit failed");
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual([
      "begin",
      `send:${ROW.aggregate_id}`,
      `mark:${ROW.id}`,
      `send:${row2.aggregate_id}`,
      `mark:${row2.id}`,
      "commit",
      "rollback",
    ]);
    expect(result.commit_outcome).toBe("unknown_pending_reconciliation");
    expect(result.unknowns).toBe(2);
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getShoppingOutboxSoftFailureCountForTests(row2.id)).toBe(1);
  });

  it("G7 ambiguous COMMIT: all false ⇒ db_not_persisted", async () => {
    const reconcilePublished = vi.fn().mockResolvedValue([{ id: ROW.id, published: false }]);
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => [ROW],
      sendToKafka: async () => undefined,
      markPublished: async () => 1,
      commit: async () => {
        throw new Error("commit ack lost");
      },
      rollback: async () => undefined,
      reconcilePublished,
    });
    expect(reconcilePublished).toHaveBeenCalledWith([ROW.id]);
    expect(result.commit_outcome).toBe("db_not_persisted");
    expect(result.unknowns).toBe(0);
    expect(result.published).toBe(0);
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "commit_failed" }]);
  });

  it("G7 ambiguous COMMIT: all true ⇒ db_ack_recovered; soft failures cleared", async () => {
    await runShoppingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => [ROW],
      sendToKafka: async () => undefined,
      markPublished: async () => 1,
      commit: async () => {
        throw new Error("commit ack lost");
      },
      rollback: async () => undefined,
      reconcilePublished: async () => [{ id: ROW.id, published: true }],
    });
    expect(result.commit_outcome).toBe("db_ack_recovered");
    expect(result.published).toBe(1);
    expect(result.unknowns).toBe(0);
    expect(__getShoppingOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G7 mixed ⇒ invariant; unresolved unknowns", async () => {
    const row2: ShoppingOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "55555555-5555-4555-8555-555555555555",
    };
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => [ROW, row2],
      sendToKafka: async () => undefined,
      markPublished: async () => 1,
      commit: async () => {
        throw new Error("commit ack lost");
      },
      rollback: async () => undefined,
      reconcilePublished: async () => [
        { id: ROW.id, published: true },
        { id: row2.id, published: false },
      ],
    });
    expect(result.commit_outcome).toBe("invariant_mixed");
    expect(result.unknowns).toBe(2);
  });

  it("G7 reconcile unavailable ⇒ unknowns != 0", async () => {
    const result = await runShoppingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => [ROW],
      sendToKafka: async () => undefined,
      markPublished: async () => 1,
      commit: async () => {
        throw new Error("commit ack lost");
      },
      rollback: async () => undefined,
      reconcilePublished: async () => {
        throw new Error("recon connection failed");
      },
    });
    expect(result.commit_outcome).toBe("unknown_pending_reconciliation");
    expect(result.unknowns).toBe(1);
    expect(classifyCommitReconciliation([], [ROW.id])).toBe(
      "unknown_pending_reconciliation",
    );
  });
});
