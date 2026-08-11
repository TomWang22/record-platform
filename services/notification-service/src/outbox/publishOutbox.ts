/**
 * notification.outbox_events publisher — Phase A drain + Phase B enqueue present.
 *
 * Holds FOR UPDATE SKIP LOCKED through broker ack → DB mark → COMMIT.
 * COMMIT throw is ambiguous: fresh-connection reconciliation before claiming
 * published=false. Soft failures never clear on unresolved commit outcome.
 *
 * Gating: NOTIFICATION_OUTBOX_PUBLISHER must be exactly "1" (default OFF).
 * Soft retry_exhaustion is process-scoped; restart resets.
 *
 * Does NOT mint a new event UUID on drain — Kafka value is the stored payload;
 * key = aggregate_id (notification_id). Readiness: LIFECYCLE_EXECUTABLE (8/1/3);
 * live publish still unauthorized.
 */
import type { Pool } from "pg";
import { getRpKafka } from "@common/utils/kafka";

const DEFAULT_PREFIX = "dev";

/** Strict topic for notification domain emits (inventory / ACL contract). */
export function notificationEventsTopic(): string {
  const prefix = process.env.ENV_PREFIX || DEFAULT_PREFIX;
  return `${prefix}.notification.events`;
}

/** @deprecated prefer notificationEventsTopic() — retained for test import convenience */
export const NOTIFICATION_EVENTS_TOPIC = notificationEventsTopic();

export type NotificationOutboxRow = {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Buffer;
};

export type NotificationPublisherDispositionOutcome =
  | "broker_unavailable"
  | "publisher_restart_after_selection"
  | "broker_ack_without_db_ack"
  | "poison_event"
  | "retry_exhaustion"
  | "published"
  | "batch_rolled_back"
  | "commit_failed"
  | "commit_outcome_unknown"
  | "db_ack_recovered"
  | "commit_invariant_mixed";

export type CommitReconciliationStatus =
  | "db_not_persisted"
  | "db_ack_recovered"
  | "invariant_mixed"
  | "unknown_pending_reconciliation";

export type NotificationPublisherTickResult = {
  claimed: number;
  published: number;
  failed: number;
  dispositions: Array<{ id: string; outcome: NotificationPublisherDispositionOutcome }>;
  /** Present when COMMIT threw; do not treat published=0 as proven without this. */
  commit_outcome?: CommitReconciliationStatus;
  unknowns?: number;
};

export type NotificationOutboxPublisherTestDeps = {
  claimBatch: () => Promise<NotificationOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  markPublished: (id: string) => Promise<number>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: (err: unknown) => Exclude<
    NotificationPublisherDispositionOutcome,
    | "published"
    | "broker_ack_without_db_ack"
    | "retry_exhaustion"
    | "batch_rolled_back"
    | "commit_failed"
  >;
};

export type NotificationOutboxLockedTickDeps = {
  beginClaimHoldLock: () => Promise<NotificationOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  markPublished: (id: string) => Promise<number>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  /**
   * Fresh-connection SELECT of claimed ids after ambiguous COMMIT.
   * Required for Track C; if omitted/unavailable ⇒ unknowns++.
   */
  reconcilePublished?: (
    ids: string[],
  ) => Promise<Array<{ id: string; published: boolean }>>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: NotificationOutboxPublisherTestDeps["classifySendError"];
};

export function classifyCommitReconciliation(
  rows: Array<{ id: string; published: boolean }>,
  claimedIds: string[],
): CommitReconciliationStatus {
  if (rows.length !== claimedIds.length) {
    return "unknown_pending_reconciliation";
  }
  const byId = new Map(rows.map((r) => [r.id, r.published]));
  for (const id of claimedIds) {
    if (!byId.has(id)) return "unknown_pending_reconciliation";
  }
  const pubs = claimedIds.map((id) => byId.get(id) === true);
  if (pubs.every((p) => p === false)) return "db_not_persisted";
  if (pubs.every((p) => p === true)) return "db_ack_recovered";
  return "invariant_mixed";
}

/** Process-scoped soft attempts; restart clears. */
const softFailureCounts = new Map<string, number>();

export function __resetNotificationOutboxSoftFailuresForTests(): void {
  softFailureCounts.clear();
}

export function __getNotificationOutboxSoftFailureCountForTests(id: string): number {
  return softFailureCounts.get(id) ?? 0;
}

export function isNotificationOutboxPublisherEnabled(): boolean {
  return process.env.NOTIFICATION_OUTBOX_PUBLISHER === "1";
}

let producer: ReturnType<ReturnType<typeof getRpKafka>["producer"]> | null = null;
let producerReady = false;

async function ensureProducer(): Promise<ReturnType<
  ReturnType<typeof getRpKafka>["producer"]
> | null> {
  if (!isNotificationOutboxPublisherEnabled()) return null;
  if (!producer) producer = getRpKafka("outbox-publisher").producer();
  if (!producerReady) {
    try {
      await producer.connect();
      producerReady = true;
    } catch (e) {
      console.warn("[notification-outbox] kafka connect failed:", (e as Error).message);
      return null;
    }
  }
  return producer;
}

function defaultClassifySendError(err: unknown): Exclude<
  NotificationPublisherDispositionOutcome,
  | "published"
  | "broker_ack_without_db_ack"
  | "retry_exhaustion"
  | "batch_rolled_back"
  | "commit_failed"
> {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("publisher_restart_after_selection")) {
    return "publisher_restart_after_selection";
  }
  if (/poison/i.test(msg)) {
    return "poison_event";
  }
  return "broker_unavailable";
}

async function defaultGetFailureCount(id: string): Promise<number> {
  return softFailureCounts.get(id) ?? 0;
}

async function defaultRecordFailure(id: string): Promise<number> {
  const next = (softFailureCounts.get(id) ?? 0) + 1;
  softFailureCounts.set(id, next);
  return next;
}

function emptyResult(): NotificationPublisherTickResult {
  return { claimed: 0, published: 0, failed: 0, dispositions: [] };
}

class NotificationOutboxPublishAbort extends Error {
  outcome: NotificationPublisherDispositionOutcome;
  rowId: string;
  constructor(rowId: string, outcome: NotificationPublisherDispositionOutcome, message: string) {
    super(message);
    this.name = "NotificationOutboxPublishAbort";
    this.rowId = rowId;
    this.outcome = outcome;
  }
}

type ProcessClaimedResult = NotificationPublisherTickResult & {
  /** Soft-failure keys to clear only after COMMIT succeeds. */
  pendingSoftFailureClearIds: string[];
};

/**
 * Deps-only path for unit tests (no TX). Clears soft failures only after full success.
 */
export async function runNotificationOutboxPublisherTickWithDeps(
  deps: NotificationOutboxPublisherTestDeps,
): Promise<NotificationPublisherTickResult> {
  const rows = await deps.claimBatch();
  try {
    const processed = await processClaimedRowsOrAbort(rows, deps);
    for (const id of processed.pendingSoftFailureClearIds) {
      softFailureCounts.delete(id);
    }
    const { pendingSoftFailureClearIds: _pending, ...result } = processed;
    return result;
  } catch (e) {
    if (e instanceof NotificationOutboxPublishAbort) {
      return {
        claimed: rows.length,
        published: 0,
        failed: 1,
        dispositions: [{ id: e.rowId, outcome: e.outcome }],
      };
    }
    throw e;
  }
}

async function processClaimedRowsOrAbort(
  rows: NotificationOutboxRow[],
  deps: Omit<NotificationOutboxPublisherTestDeps, "claimBatch">,
): Promise<ProcessClaimedResult> {
  const result: ProcessClaimedResult = {
    claimed: rows.length,
    published: 0,
    failed: 0,
    dispositions: [],
    pendingSoftFailureClearIds: [],
  };
  const maxAttempts = deps.maxAttemptsBeforeExhaustion ?? 3;
  const classify = deps.classifySendError ?? defaultClassifySendError;
  const getFailureCount = deps.getFailureCount ?? defaultGetFailureCount;
  const recordFailure = deps.recordFailure ?? defaultRecordFailure;

  for (const row of rows) {
    const buf = Buffer.isBuffer(row.payload)
      ? row.payload
      : Buffer.from(row.payload as Uint8Array);
    try {
      // Drain uses stored payload bytes; do not mint a new event_id here.
      await deps.sendToKafka(notificationEventsTopic(), row.aggregate_id, buf);
    } catch (err) {
      const next = await recordFailure(row.id);
      await getFailureCount(row.id);
      const outcome =
        next >= maxAttempts ? ("retry_exhaustion" as const) : classify(err);
      throw new NotificationOutboxPublishAbort(row.id, outcome, String(err));
    }

    try {
      const rowCount = await deps.markPublished(row.id);
      if (rowCount !== 1) {
        throw new NotificationOutboxPublishAbort(
          row.id,
          "broker_ack_without_db_ack",
          "db_ack_rowcount_not_1",
        );
      }
      // Do NOT clear softFailureCounts here — COMMIT may still fail / roll back.
      result.pendingSoftFailureClearIds.push(row.id);
      result.published += 1;
      result.dispositions.push({ id: row.id, outcome: "published" });
    } catch (err) {
      if (err instanceof NotificationOutboxPublishAbort) throw err;
      throw new NotificationOutboxPublishAbort(
        row.id,
        "broker_ack_without_db_ack",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return result;
}

/**
 * Lock-through-ack: claim TX open through send → mark → commit.
 * Batch failure rolls back ALL DB marks; broker-acked rows may duplicate on retry.
 * Soft-failure counters clear only after COMMIT succeeds.
 *
 * COMMIT throw is ambiguous: never assert published=false without fresh-connection
 * reconciliation (G7).
 */
export async function runNotificationOutboxPublisherTickLocked(
  deps: NotificationOutboxLockedTickDeps,
): Promise<NotificationPublisherTickResult> {
  let held = false;
  let claimedCount = 0;
  let pendingClear: string[] = [];
  try {
    const rows = await deps.beginClaimHoldLock();
    held = true;
    claimedCount = rows.length;
    if (rows.length === 0) {
      await deps.commit();
      return emptyResult();
    }
    const processed = await processClaimedRowsOrAbort(rows, deps);
    pendingClear = processed.pendingSoftFailureClearIds;
    try {
      await deps.commit();
    } catch (_commitErr) {
      await deps.rollback().catch(() => undefined);
      // Soft failures must never clear on ambiguous commit.
      const claimedIds = rows.map((r) => r.id);
      if (!deps.reconcilePublished) {
        return {
          claimed: claimedCount,
          published: 0,
          failed: 1,
          unknowns: claimedCount,
          commit_outcome: "unknown_pending_reconciliation",
          dispositions: [
            {
              id: rows[0]?.id ?? "unknown",
              outcome: "commit_outcome_unknown",
            },
          ],
        };
      }
      let reconRows: Array<{ id: string; published: boolean }>;
      try {
        reconRows = await deps.reconcilePublished(claimedIds);
      } catch {
        return {
          claimed: claimedCount,
          published: 0,
          failed: 1,
          unknowns: claimedCount,
          commit_outcome: "unknown_pending_reconciliation",
          dispositions: [
            {
              id: rows[0]?.id ?? "unknown",
              outcome: "commit_outcome_unknown",
            },
          ],
        };
      }
      const status = classifyCommitReconciliation(reconRows, claimedIds);
      if (status === "db_not_persisted") {
        return {
          claimed: claimedCount,
          published: 0,
          failed: 1,
          unknowns: 0,
          commit_outcome: status,
          dispositions: [
            { id: rows[0]?.id ?? "unknown", outcome: "commit_failed" },
          ],
        };
      }
      if (status === "db_ack_recovered") {
        for (const id of pendingClear) {
          softFailureCounts.delete(id);
        }
        return {
          claimed: claimedCount,
          published: claimedCount,
          failed: 0,
          unknowns: 0,
          commit_outcome: status,
          dispositions: claimedIds.map((id) => ({
            id,
            outcome: "db_ack_recovered" as const,
          })),
        };
      }
      if (status === "invariant_mixed") {
        return {
          claimed: claimedCount,
          published: 0,
          failed: 1,
          unknowns: claimedCount,
          commit_outcome: status,
          dispositions: [
            { id: rows[0]?.id ?? "unknown", outcome: "commit_invariant_mixed" },
          ],
        };
      }
      return {
        claimed: claimedCount,
        published: 0,
        failed: 1,
        unknowns: claimedCount,
        commit_outcome: "unknown_pending_reconciliation",
        dispositions: [
          { id: rows[0]?.id ?? "unknown", outcome: "commit_outcome_unknown" },
        ],
      };
    }
    for (const id of pendingClear) {
      softFailureCounts.delete(id);
    }
    const { pendingSoftFailureClearIds: _pending, ...result } = processed;
    return result;
  } catch (e) {
    await deps.rollback().catch(() => undefined);
    if (!held) {
      console.warn("[notification-outbox] claim failed:", (e as Error).message);
      return emptyResult();
    }
    if (e instanceof NotificationOutboxPublishAbort) {
      return {
        claimed: claimedCount,
        published: 0,
        failed: 1,
        dispositions: [{ id: e.rowId, outcome: e.outcome }],
      };
    }
    throw e;
  }
}

export async function publishNotificationOutboxTick(
  pool: Pool,
): Promise<NotificationPublisherTickResult> {
  if (!isNotificationOutboxPublisherEnabled()) {
    return emptyResult();
  }

  const prod = await ensureProducer();
  if (!prod) {
    return emptyResult();
  }

  const takeRaw = Number(process.env.NOTIFICATION_OUTBOX_BATCH || "25");
  const take =
    Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(200, Math.floor(takeRaw)) : 25;

  const client = await pool.connect();
  try {
    return await runNotificationOutboxPublisherTickLocked({
      beginClaimHoldLock: async () => {
        await client.query("BEGIN");
        const { rows: claimed } = await client.query<{
          id: string;
          aggregate_id: string;
          type: string;
          version: number;
          payload: Buffer;
        }>(
          `WITH picked AS (
             SELECT id FROM notification.outbox_events WHERE published = false
             ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
           )
           SELECT b.id::text AS id, b.aggregate_id, b.type, b.version, b.payload
           FROM notification.outbox_events b
           INNER JOIN picked p ON b.id = p.id`,
          [take],
        );
        return claimed.map((r) => ({
          id: r.id,
          aggregate_id: r.aggregate_id,
          type: r.type,
          version: r.version,
          payload: Buffer.isBuffer(r.payload) ? r.payload : Buffer.from(r.payload),
        }));
      },
      sendToKafka: async (topic, key, payload) => {
        await prod.send({
          topic,
          messages: [{ key, value: payload }],
        });
      },
      markPublished: async (id) => {
        const updated = await client.query(
          `UPDATE notification.outbox_events SET published = true WHERE id = $1::uuid AND published = false`,
          [id],
        );
        return updated.rowCount ?? 0;
      },
      commit: async () => {
        await client.query("COMMIT");
      },
      rollback: async () => {
        await client.query("ROLLBACK");
      },
      reconcilePublished: async (ids) => {
        // Fresh connection: claim TX client may be dead after ambiguous COMMIT.
        const recon = await pool.connect();
        try {
          const { rows } = await recon.query<{ id: string; published: boolean }>(
            `SELECT id::text AS id, published
             FROM notification.outbox_events
             WHERE id = ANY($1::uuid[])`,
            [ids],
          );
          return rows.map((r) => ({ id: r.id, published: r.published === true }));
        } finally {
          recon.release();
        }
      },
    });
  } finally {
    client.release();
  }
}

export function startNotificationOutboxPublisher(pool: Pool): NodeJS.Timeout | null {
  if (!isNotificationOutboxPublisherEnabled()) {
    console.log(
      "[notification-outbox] NOTIFICATION_OUTBOX_PUBLISHER!=1 — background publisher disabled (default OFF)",
    );
    return null;
  }
  const ms = Number(process.env.NOTIFICATION_OUTBOX_PUBLISHER_INTERVAL_MS || "2000");
  const interval = Number.isFinite(ms) && ms >= 500 ? ms : 2000;

  void publishNotificationOutboxTick(pool).catch((e) =>
    console.error("[notification-outbox] initial tick failed", e),
  );

  return setInterval(() => {
    void publishNotificationOutboxTick(pool).catch((e) =>
      console.error("[notification-outbox] tick failed", e),
    );
  }, interval);
}

export async function disconnectNotificationOutboxProducer(): Promise<void> {
  if (!producerReady || !producer) return;
  try {
    await producer.disconnect();
  } catch {
    /* ignore */
  }
  producerReady = false;
  producer = null;
}
