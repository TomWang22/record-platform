import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeRecordCreatedV1,
  decodeRecordsEventEnvelope,
  encodeRecordCreatedV1,
  RECORD_CREATED_V1,
  RECORDS_PRODUCER,
  wrapRecordsOutboxRowAsEventEnvelope,
} from "../src/recordsKafkaEvents.js";
import {
  recordsEventsTopic,
  isRecordsOutboxPublisherEnabled,
  runRecordsOutboxPublisherTickWithDeps,
  runRecordsOutboxPublisherTickLocked,
  publishRecordsOutboxTick,
  startRecordsOutboxPublisher,
  classifyCommitReconciliation,
  __resetRecordsOutboxSoftFailuresForTests,
  __getRecordsOutboxSoftFailureCountForTests,
  type RecordsOutboxRow,
  type RecordsPublisherTickResult,
} from "../src/outbox/publishOutbox.js";

const RECORD_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DOMAIN_PAYLOAD = encodeRecordCreatedV1({
  record_id: RECORD_ID,
  user_id: USER_ID,
  created_at: "2026-08-10T12:00:00.000Z",
});

const ROW: RecordsOutboxRow = {
  id: EVENT_ID,
  aggregate_id: RECORD_ID,
  type: RECORD_CREATED_V1,
  version: 1,
  payload: DOMAIN_PAYLOAD,
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

describe("records EventEnvelope wrap (protobufjs via resolveProtoPath)", () => {
  it("wraps stored domain proto as EventEnvelope; event_id === outbox.id", () => {
    const wrapped = wrapRecordsOutboxRowAsEventEnvelope(ROW);
    expect(wrapped.equals(ROW.payload)).toBe(false);
    const env = decodeRecordsEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.type).toBe(RECORD_CREATED_V1);
    expect(env.version).toBe(1);
    expect(env.source).toBe(RECORDS_PRODUCER);
    expect(env.entity_id).toBe(RECORD_ID);
    expect(env.payload.equals(DOMAIN_PAYLOAD)).toBe(true);
    expect(decodeRecordCreatedV1(env.payload)).toEqual({
      record_id: RECORD_ID,
      user_id: USER_ID,
      created_at: "2026-08-10T12:00:00.000Z",
    });
  });

  it("refuses to mint identity when outbox.id is missing", () => {
    expect(() =>
      wrapRecordsOutboxRowAsEventEnvelope({ ...ROW, id: "" }),
    ).toThrow(/records_outbox_event_id_missing/);
  });
});

describe("records outbox publisher Phase A (mocked Kafka; records stays blocked)", () => {
  const prevEnv = process.env.RECORDS_OUTBOX_PUBLISHER;
  const prevPrefix = process.env.ENV_PREFIX;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRecordsOutboxSoftFailuresForTests();
    delete process.env.RECORDS_OUTBOX_PUBLISHER;
    process.env.ENV_PREFIX = "dev";
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.RECORDS_OUTBOX_PUBLISHER;
    else process.env.RECORDS_OUTBOX_PUBLISHER = prevEnv;
    if (prevPrefix === undefined) delete process.env.ENV_PREFIX;
    else process.env.ENV_PREFIX = prevPrefix;
  });

  it("S11 default-off: only ===1 enables", () => {
    delete process.env.RECORDS_OUTBOX_PUBLISHER;
    expect(isRecordsOutboxPublisherEnabled()).toBe(false);
    process.env.RECORDS_OUTBOX_PUBLISHER = "0";
    expect(isRecordsOutboxPublisherEnabled()).toBe(false);
    process.env.RECORDS_OUTBOX_PUBLISHER = "true";
    expect(isRecordsOutboxPublisherEnabled()).toBe(false);
    process.env.RECORDS_OUTBOX_PUBLISHER = "1";
    expect(isRecordsOutboxPublisherEnabled()).toBe(true);
  });

  it("S11 default-off: start + tick no-op when unset", async () => {
    delete process.env.RECORDS_OUTBOX_PUBLISHER;
    expect(startRecordsOutboxPublisher({} as never)).toBeNull();
    const result = await publishRecordsOutboxTick({ connect: vi.fn() } as never);
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, dispositions: [] });
  });

  it("S1 happy_path: topic ${ENV_PREFIX}.records.events; key=aggregate_id; kafka_value=EventEnvelope", async () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
    const drainSrc =
      readFileSync(join(srcDir, "outbox/publishOutbox.ts"), "utf8") +
      readFileSync(join(srcDir, "recordsKafkaEvents.ts"), "utf8");
    expect(drainSrc).not.toMatch(/from ["']node:crypto["']/);
    expect(drainSrc).not.toMatch(/crypto\.randomUUID/);

    const deps = baseDeps();
    const result = await runRecordsOutboxPublisherTickWithDeps(deps);
    expect(recordsEventsTopic()).toBe("dev.records.events");
    expect(deps.sendToKafka).toHaveBeenCalledTimes(1);
    const [topic, key, value] = deps.sendToKafka.mock.calls[0] as [string, string, Buffer];
    expect(topic).toBe(recordsEventsTopic());
    expect(key).toBe(RECORD_ID);
    expect(value.equals(DOMAIN_PAYLOAD)).toBe(false);
    const env = decodeRecordsEventEnvelope(value);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.payload.equals(DOMAIN_PAYLOAD)).toBe(true);
    expect(deps.markPublished).toHaveBeenCalledWith(EVENT_ID);
    expect(result.published).toBe(1);
  });

  it("S2 empty_claim", async () => {
    const deps = baseDeps({ claimBatch: vi.fn().mockResolvedValue([]) });
    const result = await runRecordsOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it("S3 broker_unavailable: never marks", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
    });
    const result = await runRecordsOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "broker_unavailable" }]);
  });

  it("S4 restart_after_selection then recover", async () => {
    const a = await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("publisher_restart_after_selection")),
        classifySendError: vi.fn().mockReturnValue("publisher_restart_after_selection" as const),
      }),
    );
    expect(a.dispositions[0]?.outcome).toBe("publisher_restart_after_selection");
    const b = await runRecordsOutboxPublisherTickWithDeps(baseDeps());
    expect(b.published).toBe(1);
  });

  it("S5 broker_ack_without_db_ack: rowCount=0 not published", async () => {
    const result = await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({ markPublished: vi.fn().mockResolvedValue(0) }),
    );
    expect(result.published).toBe(0);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
  });

  it("S6 duplicate_delivery: second success path still marks once", async () => {
    const first = await runRecordsOutboxPublisherTickWithDeps(baseDeps());
    expect(first.published).toBe(1);
    const second = await runRecordsOutboxPublisherTickWithDeps(baseDeps());
    expect(second.published).toBe(1);
    expect(second.dispositions).toEqual([{ id: ROW.id, outcome: "published" }]);
  });

  it("S7 poison_event", async () => {
    const result = await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("poison")),
        classifySendError: vi.fn().mockReturnValue("poison_event" as const),
      }),
    );
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "poison_event" }]);
  });

  it("S8 retry_exhaustion process-scoped across ticks", async () => {
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    let last: RecordsPublisherTickResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await runRecordsOutboxPublisherTickWithDeps(
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
    await runRecordsOutboxPublisherTickWithDeps(
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
    const row2: RecordsOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "33333333-3333-4333-8333-333333333333",
    };
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runRecordsOutboxPublisherTickLocked({
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
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("S12 claim failure rolls back without send", async () => {
    const order: string[] = [];
    const result = await runRecordsOutboxPublisherTickLocked({
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
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    await runRecordsOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => {
        order.push("mark");
        expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
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
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G5 COMMIT throw without reconcile: outcome unknown; soft failures retained", async () => {
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runRecordsOutboxPublisherTickLocked({
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
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("G6 COMMIT throw: rollback invoked; not proof of unpublished", async () => {
    const row2: RecordsOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "33333333-3333-4333-8333-333333333333",
    };
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        claimBatch: vi.fn().mockResolvedValue([row2]),
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getRecordsOutboxSoftFailureCountForTests(row2.id)).toBe(1);

    const order: string[] = [];
    const result = await runRecordsOutboxPublisherTickLocked({
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
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getRecordsOutboxSoftFailureCountForTests(row2.id)).toBe(1);
  });

  it("G7 ambiguous COMMIT: all false ⇒ db_not_persisted", async () => {
    const reconcilePublished = vi.fn().mockResolvedValue([{ id: ROW.id, published: false }]);
    const result = await runRecordsOutboxPublisherTickLocked({
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
    await runRecordsOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const result = await runRecordsOutboxPublisherTickLocked({
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
    expect(__getRecordsOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G7 mixed ⇒ invariant; unresolved unknowns", async () => {
    const row2: RecordsOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "33333333-3333-4333-8333-333333333333",
    };
    const result = await runRecordsOutboxPublisherTickLocked({
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
    const result = await runRecordsOutboxPublisherTickLocked({
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
