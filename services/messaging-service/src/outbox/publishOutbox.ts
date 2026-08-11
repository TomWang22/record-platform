/**
 * messaging.outbox_events publisher — Phase A drain only.
 *
 * Holds FOR UPDATE SKIP LOCKED through broker ack → DB mark → COMMIT.
 * Any broker/send or DB-ack failure rolls back the claim transaction
 * (partial batch marks are not committed).
 *
 * Gating: MESSAGING_OUTBOX_PUBLISHER must be exactly "1" (default OFF).
 * Soft retry_exhaustion is process-scoped; restart resets.
 *
 * Does NOT mint a new event UUID on drain — Kafka value is the stored payload;
 * key = aggregate_id. Phase B must enqueue with id = frozen event identity.
 *
 * Track C: do NOT enable live publish; MESSAGING_OUTBOX_PUBLISHER must be exactly "1".
 * Phase B transactional enqueue is present; readiness flipped to LIFECYCLE_EXECUTABLE (7/1/4).
 * replaces direct sendMessagingEvent for covered events.
 */
import type { Pool } from "pg";
import { getRpKafka } from "@common/utils/kafka";
import { MESSAGING_EVENTS_TOPIC } from "../kafkaMessagingEvents.js";

export { MESSAGING_EVENTS_TOPIC };

export type MessagingOutboxRow = {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Buffer;
};

export type MessagingPublisherDispositionOutcome =
  | "broker_unavailable"
  | "publisher_restart_after_selection"
  | "broker_ack_without_db_ack"
  | "poison_event"
  | "retry_exhaustion"
  | "published"
  | "batch_rolled_back"
  | "commit_failed";

export type MessagingPublisherTickResult = {
  claimed: number;
  published: number;
  failed: number;
  dispositions: Array<{ id: string; outcome: MessagingPublisherDispositionOutcome }>;
};

export type MessagingOutboxPublisherTestDeps = {
  claimBatch: () => Promise<MessagingOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  markPublished: (id: string) => Promise<number>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: (err: unknown) => Exclude<
    MessagingPublisherDispositionOutcome,
    | "published"
    | "broker_ack_without_db_ack"
    | "retry_exhaustion"
    | "batch_rolled_back"
    | "commit_failed"
  >;
};

export type MessagingOutboxLockedTickDeps = {
  beginClaimHoldLock: () => Promise<MessagingOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  markPublished: (id: string) => Promise<number>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: MessagingOutboxPublisherTestDeps["classifySendError"];
};

/** Process-scoped soft attempts; restart clears. */
const softFailureCounts = new Map<string, number>();

export function __resetMessagingOutboxSoftFailuresForTests(): void {
  softFailureCounts.clear();
}

export function __getMessagingOutboxSoftFailureCountForTests(id: string): number {
  return softFailureCounts.get(id) ?? 0;
}

export function isMessagingOutboxPublisherEnabled(): boolean {
  return process.env.MESSAGING_OUTBOX_PUBLISHER === "1";
}

let producer: ReturnType<ReturnType<typeof getRpKafka>["producer"]> | null = null;
let producerReady = false;

async function ensureProducer(): Promise<ReturnType<
  ReturnType<typeof getRpKafka>["producer"]
> | null> {
  if (!isMessagingOutboxPublisherEnabled()) return null;
  if (!producer) producer = getRpKafka("outbox-publisher").producer();
  if (!producerReady) {
    try {
      await producer.connect();
      producerReady = true;
    } catch (e) {
      console.warn("[messaging-outbox] kafka connect failed:", (e as Error).message);
      return null;
    }
  }
  return producer;
}

function defaultClassifySendError(err: unknown): Exclude<
  MessagingPublisherDispositionOutcome,
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

function emptyResult(): MessagingPublisherTickResult {
  return { claimed: 0, published: 0, failed: 0, dispositions: [] };
}

class MessagingOutboxPublishAbort extends Error {
  outcome: MessagingPublisherDispositionOutcome;
  rowId: string;
  constructor(rowId: string, outcome: MessagingPublisherDispositionOutcome, message: string) {
    super(message);
    this.name = "MessagingOutboxPublishAbort";
    this.rowId = rowId;
    this.outcome = outcome;
  }
}

type ProcessClaimedResult = MessagingPublisherTickResult & {
  /** Soft-failure keys to clear only after COMMIT succeeds. */
  pendingSoftFailureClearIds: string[];
};

/**
 * Deps-only path for unit tests (no TX). Clears soft failures only after full success.
 */
export async function runMessagingOutboxPublisherTickWithDeps(
  deps: MessagingOutboxPublisherTestDeps,
): Promise<MessagingPublisherTickResult> {
  const rows = await deps.claimBatch();
  try {
    const processed = await processClaimedRowsOrAbort(rows, deps);
    for (const id of processed.pendingSoftFailureClearIds) {
      softFailureCounts.delete(id);
    }
    const { pendingSoftFailureClearIds: _pending, ...result } = processed;
    return result;
  } catch (e) {
    if (e instanceof MessagingOutboxPublishAbort) {
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
  rows: MessagingOutboxRow[],
  deps: Omit<MessagingOutboxPublisherTestDeps, "claimBatch">,
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
      await deps.sendToKafka(MESSAGING_EVENTS_TOPIC, row.aggregate_id, buf);
    } catch (err) {
      const next = await recordFailure(row.id);
      await getFailureCount(row.id);
      const outcome =
        next >= maxAttempts ? ("retry_exhaustion" as const) : classify(err);
      throw new MessagingOutboxPublishAbort(row.id, outcome, String(err));
    }

    try {
      const rowCount = await deps.markPublished(row.id);
      if (rowCount !== 1) {
        throw new MessagingOutboxPublishAbort(
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
      if (err instanceof MessagingOutboxPublishAbort) throw err;
      throw new MessagingOutboxPublishAbort(
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
 */
export async function runMessagingOutboxPublisherTickLocked(
  deps: MessagingOutboxLockedTickDeps,
): Promise<MessagingPublisherTickResult> {
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
    } catch (commitErr) {
      await deps.rollback().catch(() => undefined);
      // Marks are not durable; do not clear soft failures; fail closed.
      return {
        claimed: claimedCount,
        published: 0,
        failed: 1,
        dispositions: [
          {
            id: rows[0]?.id ?? "unknown",
            outcome: "commit_failed",
          },
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
      console.warn("[messaging-outbox] claim failed:", (e as Error).message);
      return emptyResult();
    }
    if (e instanceof MessagingOutboxPublishAbort) {
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

export async function publishMessagingOutboxTick(
  pool: Pool,
): Promise<MessagingPublisherTickResult> {
  if (!isMessagingOutboxPublisherEnabled()) {
    return emptyResult();
  }

  const prod = await ensureProducer();
  if (!prod) {
    return emptyResult();
  }

  const takeRaw = Number(process.env.MESSAGING_OUTBOX_BATCH || "25");
  const take =
    Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(200, Math.floor(takeRaw)) : 25;

  const client = await pool.connect();
  try {
    return await runMessagingOutboxPublisherTickLocked({
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
             SELECT id FROM messaging.outbox_events WHERE published = false
             ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
           )
           SELECT b.id::text AS id, b.aggregate_id, b.type, b.version, b.payload
           FROM messaging.outbox_events b
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
          `UPDATE messaging.outbox_events SET published = true WHERE id = $1::uuid AND published = false`,
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
    });
  } finally {
    client.release();
  }
}

export function startMessagingOutboxPublisher(pool: Pool): NodeJS.Timeout | null {
  if (!isMessagingOutboxPublisherEnabled()) {
    console.log(
      "[messaging-outbox] MESSAGING_OUTBOX_PUBLISHER!=1 — background publisher disabled (default OFF)",
    );
    return null;
  }
  const ms = Number(process.env.MESSAGING_OUTBOX_PUBLISHER_INTERVAL_MS || "2000");
  const interval = Number.isFinite(ms) && ms >= 500 ? ms : 2000;

  void publishMessagingOutboxTick(pool).catch((e) =>
    console.error("[messaging-outbox] initial tick failed", e),
  );

  return setInterval(() => {
    void publishMessagingOutboxTick(pool).catch((e) =>
      console.error("[messaging-outbox] tick failed", e),
    );
  }, interval);
}

export async function disconnectMessagingOutboxProducer(): Promise<void> {
  if (!producerReady || !producer) return;
  try {
    await producer.disconnect();
  } catch {
    /* ignore */
  }
  producerReady = false;
  producer = null;
}
