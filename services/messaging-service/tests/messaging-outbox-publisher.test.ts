import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MESSAGING_EVENTS_TOPIC,
  isMessagingOutboxPublisherEnabled,
  runMessagingOutboxPublisherTickWithDeps,
  runMessagingOutboxPublisherTickLocked,
  publishMessagingOutboxTick,
  startMessagingOutboxPublisher,
  __resetMessagingOutboxSoftFailuresForTests,
  __getMessagingOutboxSoftFailureCountForTests,
  type MessagingOutboxRow,
  type MessagingPublisherTickResult,
} from "../src/outbox/publishOutbox.js";

const ROW: MessagingOutboxRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  aggregate_id: "conv-agg-1",
  type: "MessageSentV1",
  version: 1,
  payload: Buffer.from("messaging-envelope-bytes"),
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

describe("messaging outbox publisher Phase A (mocked Kafka; messaging stays blocked)", () => {
  const prevEnv = process.env.MESSAGING_OUTBOX_PUBLISHER;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetMessagingOutboxSoftFailuresForTests();
    delete process.env.MESSAGING_OUTBOX_PUBLISHER;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MESSAGING_OUTBOX_PUBLISHER;
    else process.env.MESSAGING_OUTBOX_PUBLISHER = prevEnv;
  });

  it("S11 default-off: only ===1 enables", () => {
    delete process.env.MESSAGING_OUTBOX_PUBLISHER;
    expect(isMessagingOutboxPublisherEnabled()).toBe(false);
    process.env.MESSAGING_OUTBOX_PUBLISHER = "0";
    expect(isMessagingOutboxPublisherEnabled()).toBe(false);
    process.env.MESSAGING_OUTBOX_PUBLISHER = "true";
    expect(isMessagingOutboxPublisherEnabled()).toBe(false);
    process.env.MESSAGING_OUTBOX_PUBLISHER = "1";
    expect(isMessagingOutboxPublisherEnabled()).toBe(true);
  });

  it("S11 default-off: start + tick no-op when unset", async () => {
    delete process.env.MESSAGING_OUTBOX_PUBLISHER;
    expect(startMessagingOutboxPublisher({} as never)).toBeNull();
    const result = await publishMessagingOutboxTick({ connect: vi.fn() } as never);
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, dispositions: [] });
  });

  it("S1 happy_path: topic messaging.events.v1; key=aggregate_id; no new event UUID", async () => {
    const deps = baseDeps();
    const result = await runMessagingOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).toHaveBeenCalledWith(
      MESSAGING_EVENTS_TOPIC,
      ROW.aggregate_id,
      ROW.payload,
    );
    expect(MESSAGING_EVENTS_TOPIC).toBe("messaging.events.v1");
    expect(deps.markPublished).toHaveBeenCalledWith(ROW.id);
    expect(result.published).toBe(1);
  });

  it("S2 empty_claim", async () => {
    const deps = baseDeps({ claimBatch: vi.fn().mockResolvedValue([]) });
    const result = await runMessagingOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it("S3 broker_unavailable: never marks", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
    });
    const result = await runMessagingOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "broker_unavailable" }]);
  });

  it("S4 restart_after_selection then recover", async () => {
    const a = await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("publisher_restart_after_selection")),
        classifySendError: vi.fn().mockReturnValue("publisher_restart_after_selection" as const),
      }),
    );
    expect(a.dispositions[0]?.outcome).toBe("publisher_restart_after_selection");
    const b = await runMessagingOutboxPublisherTickWithDeps(baseDeps());
    expect(b.published).toBe(1);
  });

  it("S5/G4 broker_ack_without_db_ack: rowCount=0 not published", async () => {
    const result = await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({ markPublished: vi.fn().mockResolvedValue(0) }),
    );
    expect(result.published).toBe(0);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
  });

  it("S7 poison_event", async () => {
    const result = await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("poison")),
        classifySendError: vi.fn().mockReturnValue("poison_event" as const),
      }),
    );
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "poison_event" }]);
  });

  it("S8 retry_exhaustion process-scoped across ticks", async () => {
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    let last: MessagingPublisherTickResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await runMessagingOutboxPublisherTickWithDeps(
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
    await runMessagingOutboxPublisherTickWithDeps(
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
    const row2: MessagingOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "conv-agg-2",
    };
    // Seed a soft failure so we can assert it is NOT cleared on rolled-back mark.
    await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runMessagingOutboxPublisherTickLocked({
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
    expect(order).toEqual([
      "begin",
      "send1",
      `mark:${ROW.id}`,
      "send2",
      "rollback",
    ]);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
    // row1 was broker-acked then rolled back — soft failure must still be present
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("G3 soft failures clear only after successful COMMIT", async () => {
    await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    await runMessagingOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => {
        order.push("mark");
        // Must still see soft failure until commit
        expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
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
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G5 COMMIT failure: marks not durable; published=0; soft failures retained", async () => {
    await runMessagingOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runMessagingOutboxPublisherTickLocked({
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
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "commit_failed" }]);
    expect(__getMessagingOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("G2 lock-through-ack happy: begin → send → mark → commit", async () => {
    const order: string[] = [];
    const result = await runMessagingOutboxPublisherTickLocked({
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
      },
      rollback: async () => {
        order.push("rollback");
      },
    });
    expect(order).toEqual(["begin", "send", "mark", "commit"]);
    expect(result.published).toBe(1);
  });

  it("G2 claim failure rolls back without send", async () => {
    const order: string[] = [];
    const result = await runMessagingOutboxPublisherTickLocked({
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
});
