import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  notificationEventsTopic,
  isNotificationOutboxPublisherEnabled,
  runNotificationOutboxPublisherTickWithDeps,
  runNotificationOutboxPublisherTickLocked,
  publishNotificationOutboxTick,
  startNotificationOutboxPublisher,
  classifyCommitReconciliation,
  __resetNotificationOutboxSoftFailuresForTests,
  __getNotificationOutboxSoftFailureCountForTests,
  type NotificationOutboxRow,
  type NotificationPublisherTickResult,
} from "../src/outbox/publishOutbox.js";

const ROW: NotificationOutboxRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  aggregate_id: "notif-agg-1",
  type: "NotificationCreatedV1",
  version: 1,
  payload: Buffer.from(
    JSON.stringify({
      metadata: { event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", event_type: "NotificationCreated" },
      notification_id: "notif-agg-1",
    }),
    "utf8",
  ),
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

describe("notification outbox publisher Phase A (mocked Kafka; notification stays blocked)", () => {
  const prevEnv = process.env.NOTIFICATION_OUTBOX_PUBLISHER;
  const prevPrefix = process.env.ENV_PREFIX;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetNotificationOutboxSoftFailuresForTests();
    delete process.env.NOTIFICATION_OUTBOX_PUBLISHER;
    process.env.ENV_PREFIX = "dev";
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NOTIFICATION_OUTBOX_PUBLISHER;
    else process.env.NOTIFICATION_OUTBOX_PUBLISHER = prevEnv;
    if (prevPrefix === undefined) delete process.env.ENV_PREFIX;
    else process.env.ENV_PREFIX = prevPrefix;
  });

  it("S11 default-off: only ===1 enables", () => {
    delete process.env.NOTIFICATION_OUTBOX_PUBLISHER;
    expect(isNotificationOutboxPublisherEnabled()).toBe(false);
    process.env.NOTIFICATION_OUTBOX_PUBLISHER = "0";
    expect(isNotificationOutboxPublisherEnabled()).toBe(false);
    process.env.NOTIFICATION_OUTBOX_PUBLISHER = "true";
    expect(isNotificationOutboxPublisherEnabled()).toBe(false);
    process.env.NOTIFICATION_OUTBOX_PUBLISHER = "1";
    expect(isNotificationOutboxPublisherEnabled()).toBe(true);
  });

  it("S11 default-off: start + tick no-op when unset", async () => {
    delete process.env.NOTIFICATION_OUTBOX_PUBLISHER;
    expect(startNotificationOutboxPublisher({} as never)).toBeNull();
    const result = await publishNotificationOutboxTick({ connect: vi.fn() } as never);
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, dispositions: [] });
  });

  it("S1 happy_path: topic ${ENV_PREFIX}.notification.events; key=aggregate_id; stored bytes", async () => {
    const deps = baseDeps();
    const result = await runNotificationOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).toHaveBeenCalledWith(
      notificationEventsTopic(),
      ROW.aggregate_id,
      ROW.payload,
    );
    expect(notificationEventsTopic()).toBe("dev.notification.events");
    expect(deps.markPublished).toHaveBeenCalledWith(ROW.id);
    expect(result.published).toBe(1);
  });

  it("S2 empty_claim", async () => {
    const deps = baseDeps({ claimBatch: vi.fn().mockResolvedValue([]) });
    const result = await runNotificationOutboxPublisherTickWithDeps(deps);
    expect(deps.sendToKafka).not.toHaveBeenCalled();
    expect(result.claimed).toBe(0);
  });

  it("S3 broker_unavailable: never marks", async () => {
    const deps = baseDeps({
      sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
    });
    const result = await runNotificationOutboxPublisherTickWithDeps(deps);
    expect(deps.markPublished).not.toHaveBeenCalled();
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "broker_unavailable" }]);
  });

  it("S4 restart_after_selection then recover", async () => {
    const a = await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("publisher_restart_after_selection")),
        classifySendError: vi.fn().mockReturnValue("publisher_restart_after_selection" as const),
      }),
    );
    expect(a.dispositions[0]?.outcome).toBe("publisher_restart_after_selection");
    const b = await runNotificationOutboxPublisherTickWithDeps(baseDeps());
    expect(b.published).toBe(1);
  });

  it("S5 broker_ack_without_db_ack: rowCount=0 not published", async () => {
    const result = await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({ markPublished: vi.fn().mockResolvedValue(0) }),
    );
    expect(result.published).toBe(0);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "broker_ack_without_db_ack" },
    ]);
  });

  it("S6 duplicate_delivery: second success path still marks once", async () => {
    const first = await runNotificationOutboxPublisherTickWithDeps(baseDeps());
    expect(first.published).toBe(1);
    const second = await runNotificationOutboxPublisherTickWithDeps(baseDeps());
    expect(second.published).toBe(1);
    expect(second.dispositions).toEqual([{ id: ROW.id, outcome: "published" }]);
  });

  it("S7 poison_event", async () => {
    const result = await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("poison")),
        classifySendError: vi.fn().mockReturnValue("poison_event" as const),
      }),
    );
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "poison_event" }]);
  });

  it("S8 retry_exhaustion process-scoped across ticks", async () => {
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    let last: NotificationPublisherTickResult | null = null;
    for (let i = 0; i < 3; i += 1) {
      last = await runNotificationOutboxPublisherTickWithDeps(
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
    await runNotificationOutboxPublisherTickWithDeps(
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
    const row2: NotificationOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "notif-agg-2",
    };
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runNotificationOutboxPublisherTickLocked({
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
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("S12 claim failure rolls back without send", async () => {
    const order: string[] = [];
    const result = await runNotificationOutboxPublisherTickLocked({
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
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    await runNotificationOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        order.push("begin");
        return [ROW];
      },
      sendToKafka: async () => {
        order.push("send");
      },
      markPublished: async () => {
        order.push("mark");
        expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
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
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G5 COMMIT throw without reconcile: outcome unknown; soft failures retained (not proof of published=0)", async () => {
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const order: string[] = [];
    const result = await runNotificationOutboxPublisherTickLocked({
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
    expect(result.unknowns).toBe(1);
    expect(result.commit_outcome).toBe("unknown_pending_reconciliation");
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "commit_outcome_unknown" },
    ]);
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
  });

  it("G6 COMMIT throw: rollback invoked; soft state retained; no published=false claim without reconcile", async () => {
    const row2: NotificationOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "notif-agg-2",
    };
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        claimBatch: vi.fn().mockResolvedValue([row2]),
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getNotificationOutboxSoftFailureCountForTests(row2.id)).toBe(1);

    const order: string[] = [];
    const result = await runNotificationOutboxPublisherTickLocked({
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
    // Rollback best-effort only — COMMIT may still have persisted server-side.
    expect(result.commit_outcome).toBe("unknown_pending_reconciliation");
    expect(result.unknowns).toBe(2);
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "commit_outcome_unknown" },
    ]);
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);
    expect(__getNotificationOutboxSoftFailureCountForTests(row2.id)).toBe(1);
  });

  it("G7 ambiguous COMMIT: fresh-connection SELECT all false ⇒ db_not_persisted", async () => {
    const reconcilePublished = vi.fn().mockResolvedValue([{ id: ROW.id, published: false }]);
    const result = await runNotificationOutboxPublisherTickLocked({
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
    await runNotificationOutboxPublisherTickWithDeps(
      baseDeps({
        sendToKafka: vi.fn().mockRejectedValue(new Error("broker down")),
        getFailureCount: undefined,
        recordFailure: undefined,
      }),
    );
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(1);

    const result = await runNotificationOutboxPublisherTickLocked({
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
    expect(result.dispositions).toEqual([{ id: ROW.id, outcome: "db_ack_recovered" }]);
    expect(__getNotificationOutboxSoftFailureCountForTests(ROW.id)).toBe(0);
  });

  it("G7 ambiguous COMMIT: mixed ⇒ invariant; unresolved unknowns", async () => {
    const row2: NotificationOutboxRow = {
      ...ROW,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aggregate_id: "notif-agg-2",
    };
    const result = await runNotificationOutboxPublisherTickLocked({
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
    expect(result.dispositions).toEqual([
      { id: ROW.id, outcome: "commit_invariant_mixed" },
    ]);
  });

  it("G7 reconcile unavailable ⇒ unknowns != 0", async () => {
    const result = await runNotificationOutboxPublisherTickLocked({
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

  it("lock-through-ack happy: begin → send → mark → commit", async () => {
    const order: string[] = [];
    const result = await runNotificationOutboxPublisherTickLocked({
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
});
