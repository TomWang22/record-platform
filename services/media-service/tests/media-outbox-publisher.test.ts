import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MEDIA_EVENTS_TOPIC,
  isMediaOutboxPublisherEnabled,
  runMediaOutboxPublisherTickWithDeps,
  runMediaOutboxPublisherTickLocked,
  publishMediaOutboxTick,
  startMediaOutboxPublisher,
  __resetMediaOutboxSoftFailuresForTests,
  type MediaOutboxRow,
  type MediaPublisherTickResult,
} from "../src/outbox/publishOutbox.js";

const ROW: MediaOutboxRow = {
  id: "11111111-1111-4111-8111-111111111111",
  aggregate_id: "media-agg-1",
  type: "MediaUploadedV1",
  version: 1,
  payload: Buffer.from("media-envelope"),
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

describe("media outbox publisher (mocked Kafka)", () => {
  const prevEnv = process.env.MEDIA_OUTBOX_PUBLISHER;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetMediaOutboxSoftFailuresForTests();
    delete process.env.MEDIA_OUTBOX_PUBLISHER;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MEDIA_OUTBOX_PUBLISHER;
    else process.env.MEDIA_OUTBOX_PUBLISHER = prevEnv;
  });

  it("G1 default-off: unset and non-1 values disable publisher", () => {
    delete process.env.MEDIA_OUTBOX_PUBLISHER;
    expect(isMediaOutboxPublisherEnabled()).toBe(false);

    process.env.MEDIA_OUTBOX_PUBLISHER = "0";
    expect(isMediaOutboxPublisherEnabled()).toBe(false);

    process.env.MEDIA_OUTBOX_PUBLISHER = "true";
    expect(isMediaOutboxPublisherEnabled()).toBe(false);

    process.env.MEDIA_OUTBOX_PUBLISHER = "1";
    expect(isMediaOutboxPublisherEnabled()).toBe(true);
  });

  it("G1 default-off: startMediaOutboxPublisher returns null unless explicitly 1", () => {
    delete process.env.MEDIA_OUTBOX_PUBLISHER;
    expect(startMediaOutboxPublisher({} as never)).toBeNull();

    process.env.MEDIA_OUTBOX_PUBLISHER = "0";
    expect(startMediaOutboxPublisher({} as never)).toBeNull();

    process.env.MEDIA_OUTBOX_PUBLISHER = "1";
    // enabled path needs a real pool/kafka — only assert gate opens past null check via tick stub below
  });

  it("G1 default-off: publishMediaOutboxTick no-ops when unset", async () => {
    delete process.env.MEDIA_OUTBOX_PUBLISHER;
    const result = await publishMediaOutboxTick({
      connect: vi.fn(),
    } as never);
    expect(result).toEqual({
      claimed: 0,
      published: 0,
      failed: 0,
      dispositions: [],
    });
  });

  it("M1 happy_path: claim → produce → mark published after broker ack", async () => {
    const deps = baseDeps();
    const result = await runMediaOutboxPublisherTickWithDeps(deps);

    expect(deps.sendToKafka).toHaveBeenCalledWith(
      MEDIA_EVENTS_TOPIC,
      ROW.aggregate_id,
      ROW.payload,
    );
    expect(deps.markPublished).toHaveBeenCalledWith(ROW.id);
    expect(deps.sendToKafka.mock.invocationCallOrder[0]).toBeLessThan(
      deps.markPublished.mock.invocationCallOrder[0],
    );
    expect(result.published).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("M2 empty_claim: no send and no mark", async () => {
    const deps = baseDeps({ claimBatch: vi.fn().mockResolvedValue([]) });
    const result = await runMediaOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).not.toHaveBeenCalled();
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.published).toBe(0);
    expect(result.claimed).toBe(0);
  });

  it("M3 broker_unavailable: never marks published", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
    });
    const result = await runMediaOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_unavailable" },
    ]);
  });

  it("M4 restart_after_selection: crash before send leaves unpublished; next tick publishes", async () => {
    const depsA = baseDeps({
      sendToKafka: vi.fn().mockImplementation(async () => {
        throw new Error("publisher_restart_after_selection");
      }),
      classifySendError: vi.fn().mockReturnValue("publisher_restart_after_selection" as const),
    });
    const resultA = await runMediaOutboxPublisherTickWithDeps(depsA);
    expect(depsA.markPublished).not.toHaveBeenCalled();
    expect(resultA.dispositions[0]?.outcome).toBe("publisher_restart_after_selection");

    const depsB = baseDeps();
    const resultB = await runMediaOutboxPublisherTickWithDeps(depsB);
    expect(depsB.markPublished).toHaveBeenCalledWith(ROW.id);
    expect(resultB.published).toBe(1);
  });

  it("M5/M6 broker_ack_before_db_ack then retry: DB stays unpublished until mark succeeds; duplicate produce allowed", async () => {
    const markPublished = vi
      .fn()
      .mockRejectedValueOnce(new Error("db ack failed"))
      .mockResolvedValueOnce(1);
    const sendToKafka = vi.fn().mockResolvedValue(undefined);
    const claimBatch = vi.fn().mockResolvedValue([ROW]);

    const resultA = await runMediaOutboxPublisherTickWithDeps(
      baseDeps({ claimBatch, sendToKafka, markPublished }),
    );
    expect(sendToKafka).toHaveBeenCalledTimes(1);
    expect(resultA.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
    expect(resultA.published).toBe(0);

    const resultB = await runMediaOutboxPublisherTickWithDeps(
      baseDeps({ claimBatch, sendToKafka, markPublished }),
    );
    expect(sendToKafka).toHaveBeenCalledTimes(2);
    expect(markPublished).toHaveBeenCalledTimes(2);
    expect(resultB.published).toBe(1);
  });

  it("M7 poison_event: never marks published; disposition poison_event", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("poison")),
      classifySendError: vi.fn().mockReturnValue("poison_event" as const),
    });
    const result = await runMediaOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "poison_event" }]);
  });

  it("M8/G3 retry_exhaustion accumulates across ticks via process-scoped soft map", async () => {
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    let last: MediaPublisherTickResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await runMediaOutboxPublisherTickWithDeps(
        baseDeps({
          sendToKafka,
          // omit get/record → production soft map path
          getFailureCount: undefined,
          recordFailure: undefined,
          maxAttemptsBeforeExhaustion: 3,
        }),
      );
    }
    expect(sendToKafka).toHaveBeenCalledTimes(3);
    expect(last?.dispositions).toEqual([
      { id: ROW.id, outcome: "retry_exhaustion" },
    ]);
  });

  it("M9 ordering: markPublished never invoked before send settles", async () => {
    let sendSettled = false;
    const order: string[] = [];
    const deps = baseDeps({
      sendToKafka: vi.fn().mockImplementation(async () => {
        order.push("send_start");
        await Promise.resolve();
        sendSettled = true;
        order.push("send_done");
      }),
      markPublished: vi.fn().mockImplementation(async () => {
        expect(sendSettled).toBe(true);
        order.push("mark");
        return 1;
      }),
    });
    await runMediaOutboxPublisherTickWithDeps(deps);
    expect(order).toEqual(["send_start", "send_done", "mark"]);
  });

  it("M10 batch_partial_failure: first row marked, second not", async () => {
    const row2: MediaOutboxRow = {
      ...ROW,
      id: "22222222-2222-4222-8222-222222222222",
      aggregate_id: "media-agg-2",
    };
    const sendToKafka = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("broker down"));
    const markPublished = vi.fn().mockResolvedValue(1);
    const result = await runMediaOutboxPublisherTickWithDeps(
      baseDeps({
        claimBatch: vi.fn().mockResolvedValue([ROW, row2]),
        sendToKafka,
        markPublished,
      }),
    );
    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(markPublished).toHaveBeenCalledWith(ROW.id);
    expect(result.published).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("G4 fail-closed DB ack: rowCount=0 does not increment published", async () => {
    const deps = baseDeps({
      markPublished: vi.fn().mockResolvedValue(0),
    });
    const result = await runMediaOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).toHaveBeenCalledWith(ROW.id);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
  });

  it("G2 lock-through-ack: commit only after send+mark; lock held across produce", async () => {
    const order: string[] = [];
    const result = await runMediaOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin_claim");
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
    expect(order).toEqual(["begin_claim", "send", "mark", "commit"]);
    expect(result.published).toBe(1);
  });

  it("G2 lock-through-ack: broker failure still commits held tx (row stays unpublished in DB)", async () => {
    const order: string[] = [];
    const result = await runMediaOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin_claim");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
        throw new Error("broker down");
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
    expect(order).toEqual(["begin_claim", "send", "commit"]);
    expect(result.published).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("G2 lock-through-ack: claim failure rolls back without send", async () => {
    const order: string[] = [];
    const result = await runMediaOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin_claim");
        throw new Error("claim failed");
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
    expect(order).toEqual(["begin_claim", "rollback"]);
    expect(result.claimed).toBe(0);
    expect(result.published).toBe(0);
  });
});
