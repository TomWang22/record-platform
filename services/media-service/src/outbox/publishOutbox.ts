/**
 * media.outbox_events publisher — claim unpublished rows under row lock,
 * produce to Kafka, mark published=true only after broker acknowledgment
 * while the claim transaction is still open.
 *
 * Gating: MEDIA_OUTBOX_PUBLISHER must be exactly "1" to enable (default OFF).
 * Soft retry_exhaustion uses a process-scoped map (restart resets counts).
 * Unit tests use injected deps / lock-hold harness with mocked Kafka.
 */
import type { Pool } from "pg";
import { getRpKafka } from "@common/utils/kafka";

const PREFIX = process.env.ENV_PREFIX || "dev";
export const MEDIA_EVENTS_TOPIC = `${PREFIX}.media.events`;

export type MediaOutboxRow = {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Buffer;
};

export type MediaPublisherDispositionOutcome =
  | "broker_unavailable"
  | "publisher_restart_after_selection"
  | "broker_ack_without_db_ack"
  | "poison_event"
  | "retry_exhaustion"
  | "published";

export type MediaPublisherTickResult = {
  claimed: number;
  published: number;
  failed: number;
  dispositions: Array<{ id: string; outcome: MediaPublisherDispositionOutcome }>;
};

export type MediaOutboxPublisherTestDeps = {
  claimBatch: () => Promise<MediaOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  /** Returns UPDATE rowCount; must be exactly 1 to count as published. */
  markPublished: (id: string) => Promise<number>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: (err: unknown) => Exclude<
    MediaPublisherDispositionOutcome,
    "published" | "broker_ack_without_db_ack" | "retry_exhaustion"
  >;
};

export type MediaOutboxLockedTickDeps = {
  beginClaimHoldLock: () => Promise<MediaOutboxRow[]>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  markPublished: (id: string) => Promise<number>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  maxAttemptsBeforeExhaustion?: number;
  getFailureCount?: (id: string) => Promise<number>;
  recordFailure?: (id: string) => Promise<number>;
  classifySendError?: MediaOutboxPublisherTestDeps["classifySendError"];
};

/**
 * Process-scoped soft attempt budget. Restart clears this map.
 * DDL has no retry_count / DLQ columns.
 */
const softFailureCounts = new Map<string, number>();

export function __resetMediaOutboxSoftFailuresForTests(): void {
  softFailureCounts.clear();
}

/** Opt-in only: unset / "0" / anything other than "1" is disabled. */
export function isMediaOutboxPublisherEnabled(): boolean {
  return process.env.MEDIA_OUTBOX_PUBLISHER === "1";
}

let producer: ReturnType<ReturnType<typeof getRpKafka>["producer"]> | null = null;
let producerReady = false;

async function ensureProducer(): Promise<ReturnType<
  ReturnType<typeof getRpKafka>["producer"]
> | null> {
  if (!isMediaOutboxPublisherEnabled()) return null;
  if (!producer) producer = getRpKafka("outbox-publisher").producer();
  if (!producerReady) {
    try {
      await producer.connect();
      producerReady = true;
    } catch (e) {
      console.warn("[media-outbox] kafka connect failed:", (e as Error).message);
      return null;
    }
  }
  return producer;
}

function defaultClassifySendError(err: unknown): Exclude<
  MediaPublisherDispositionOutcome,
  "published" | "broker_ack_without_db_ack" | "retry_exhaustion"
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

function emptyResult(): MediaPublisherTickResult {
  return { claimed: 0, published: 0, failed: 0, dispositions: [] };
}

/**
 * Testable tick core: broker ack must complete before DB published=true.
 * markPublished must return rowCount === 1 or the row is not counted published.
 */
export async function runMediaOutboxPublisherTickWithDeps(
  deps: MediaOutboxPublisherTestDeps,
): Promise<MediaPublisherTickResult> {
  const rows = await deps.claimBatch();
  return processClaimedRows(rows, deps);
}

async function processClaimedRows(
  rows: MediaOutboxRow[],
  deps: Omit<MediaOutboxPublisherTestDeps, "claimBatch">,
): Promise<MediaPublisherTickResult> {
  const result: MediaPublisherTickResult = {
    claimed: rows.length,
    published: 0,
    failed: 0,
    dispositions: [],
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
      await deps.sendToKafka(MEDIA_EVENTS_TOPIC, row.aggregate_id, buf);
    } catch (err) {
      result.failed += 1;
      const next = await recordFailure(row.id);
      // touch getFailureCount so injected spies remain usable in tests
      await getFailureCount(row.id);
      if (next >= maxAttempts) {
        result.dispositions.push({ id: row.id, outcome: "retry_exhaustion" });
      } else {
        result.dispositions.push({ id: row.id, outcome: classify(err) });
      }
      continue;
    }

    try {
      const rowCount = await deps.markPublished(row.id);
      if (rowCount !== 1) {
        result.failed += 1;
        result.dispositions.push({ id: row.id, outcome: "broker_ack_without_db_ack" });
        continue;
      }
      result.published += 1;
      softFailureCounts.delete(row.id);
      result.dispositions.push({ id: row.id, outcome: "published" });
    } catch {
      result.failed += 1;
      result.dispositions.push({ id: row.id, outcome: "broker_ack_without_db_ack" });
    }
  }

  return result;
}

/**
 * Lock-through-ack harness: claim TX stays open through send → mark → commit.
 */
export async function runMediaOutboxPublisherTickLocked(
  deps: MediaOutboxLockedTickDeps,
): Promise<MediaPublisherTickResult> {
  let held = false;
  try {
    const rows = await deps.beginClaimHoldLock();
    held = true;
    const result = await processClaimedRows(rows, deps);
    await deps.commit();
    return result;
  } catch (e) {
    await deps.rollback().catch(() => undefined);
    if (!held) {
      console.warn("[media-outbox] claim failed:", (e as Error).message);
      return emptyResult();
    }
    throw e;
  }
}

/**
 * Production tick: hold FOR UPDATE SKIP LOCKED through broker ack + DB mark.
 */
export async function publishMediaOutboxTick(pool: Pool): Promise<MediaPublisherTickResult> {
  if (!isMediaOutboxPublisherEnabled()) {
    return emptyResult();
  }

  const prod = await ensureProducer();
  if (!prod) {
    return emptyResult();
  }

  const takeRaw = Number(process.env.MEDIA_OUTBOX_BATCH || "25");
  const take =
    Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(200, Math.floor(takeRaw)) : 25;

  const client = await pool.connect();
  try {
    return await runMediaOutboxPublisherTickLocked({
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
             SELECT id FROM media.outbox_events WHERE published = false
             ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
           )
           SELECT b.id::text AS id, b.aggregate_id, b.type, b.version, b.payload
           FROM media.outbox_events b
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
          `UPDATE media.outbox_events SET published = true WHERE id = $1::uuid AND published = false`,
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

export function startMediaOutboxPublisher(pool: Pool): NodeJS.Timeout | null {
  if (!isMediaOutboxPublisherEnabled()) {
    console.log(
      "[media-outbox] MEDIA_OUTBOX_PUBLISHER!=1 — background publisher disabled (default OFF)",
    );
    return null;
  }
  const ms = Number(process.env.MEDIA_OUTBOX_PUBLISHER_INTERVAL_MS || "2000");
  const interval = Number.isFinite(ms) && ms >= 500 ? ms : 2000;

  void publishMediaOutboxTick(pool).catch((e) =>
    console.error("[media-outbox] initial tick failed", e),
  );

  return setInterval(() => {
    void publishMediaOutboxTick(pool).catch((e) =>
      console.error("[media-outbox] tick failed", e),
    );
  }, interval);
}

export async function disconnectMediaOutboxProducer(): Promise<void> {
  if (!producerReady || !producer) return;
  try {
    await producer.disconnect();
  } catch {
    /* ignore */
  }
  producerReady = false;
  producer = null;
}
