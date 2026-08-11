import type { Pool, PoolClient } from "pg";
import { enrichBookingPayloadFromSiblingNotifications } from "./booking-identity-enrich.js";
import { enqueueNotificationCreatedOnClient } from "./application/notificationOutbox.js";
import { withNotificationTransaction } from "./lib/transaction.js";

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

export type UpsertNotificationResult = {
  inserted: boolean;
  notificationId: string | null;
  readAt: string | null;
  /** Set only when a new domain row was created and outbox enqueued. */
  eventId: string | null;
};

async function mergeExistingPayload(
  client: Pool | PoolClient,
  payloadJson: string,
  dk: string,
  userId: string,
): Promise<UpsertNotificationResult> {
  await client.query(
    `UPDATE notification.notifications
     SET payload = notification.notifications.payload || $1::jsonb
     WHERE dedupe_key = $2 AND user_id = $3::uuid`,
    [payloadJson, dk, userId],
  );
  const again = await client.query<{ id: string; read_at: string | null }>(
    `SELECT id::text, read_at FROM notification.notifications
     WHERE dedupe_key = $1 AND user_id = $2::uuid LIMIT 1`,
    [dk, userId],
  );
  const row = again.rows[0];
  return {
    inserted: false,
    notificationId: row?.id ?? null,
    readAt: row?.read_at ?? null,
    eventId: null,
  };
}

/**
 * Insert or merge payload by dedupe_key. Never touches read_at on update.
 * Returns inserted=true only when a new row was created; only then enqueues
 * NotificationCreatedV1 in the same transaction (E12: dedupe hit ⇒ zero outbox).
 */
export async function upsertNotificationByDedupeKey(
  pool: Pool,
  input: {
    userId: string;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<UpsertNotificationResult> {
  const userId = String(input.userId || "").trim().toLowerCase();
  const dk = String(input.dedupeKey || "").trim();
  const eventType = String(input.eventType || "").trim().slice(0, 120);
  if (!userId || !dk || !eventType) {
    return { inserted: false, notificationId: null, readAt: null, eventId: null };
  }
  const enriched = await enrichBookingPayloadFromSiblingNotifications(pool, userId, input.payload);
  const payloadJson = JSON.stringify(enriched);

  const existing = await pool.query<{ id: string; read_at: string | null }>(
    `SELECT id::text, read_at FROM notification.notifications
     WHERE dedupe_key = $1 AND user_id = $2::uuid
     LIMIT 1`,
    [dk, userId],
  );
  if (existing.rows.length > 0) {
    // E12: dedupe hit — no event_id minted, no outbox insert.
    await pool.query(
      `UPDATE notification.notifications
       SET payload = notification.notifications.payload || $1::jsonb
       WHERE dedupe_key = $2 AND user_id = $3::uuid`,
      [payloadJson, dk, userId],
    );
    const row = existing.rows[0];
    return {
      inserted: false,
      notificationId: row?.id ?? null,
      readAt: row?.read_at ?? null,
      eventId: null,
    };
  }

  const bid = String(enriched.booking_id ?? enriched.bookingId ?? enriched.context_id ?? "")
    .trim()
    .toLowerCase();
  let inheritedReadAt: string | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bid)) {
    const priorRead = await pool.query<{ read_at: string }>(
      `SELECT read_at
       FROM notification.notifications
       WHERE user_id = $1::uuid
         AND read_at IS NOT NULL
         AND (
           LOWER(COALESCE(payload->>'context_id', '')) = $2
           OR LOWER(COALESCE(payload->>'booking_id', '')) = $2
           OR LOWER(COALESCE(payload->>'bookingId', '')) = $2
           OR payload::text ILIKE '%' || $2 || '%'
         )
       ORDER BY read_at DESC
       LIMIT 1`,
      [userId, bid],
    );
    inheritedReadAt = priorRead.rows[0]?.read_at?.toString() ?? null;
  }

  try {
    return await withNotificationTransaction(pool, async (client) => {
      const raced = await client.query<{ id: string; read_at: string | null }>(
        `SELECT id::text, read_at FROM notification.notifications
         WHERE dedupe_key = $1 AND user_id = $2::uuid
         LIMIT 1`,
        [dk, userId],
      );
      if (raced.rows.length > 0) {
        return mergeExistingPayload(client, payloadJson, dk, userId);
      }

      const ins = await client.query<{ id: string; read_at: string | null; created_at: Date }>(
        `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload, dedupe_key, read_at)
         VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb, $4, $5::timestamptz)
         RETURNING id::text, read_at, created_at`,
        [userId, eventType, payloadJson, dk, inheritedReadAt],
      );
      if (ins.rowCount !== 1 || !ins.rows[0]) {
        throw new Error(
          `notification_upsert_insert_rowcount:${ins.rowCount ?? "null"}!=1`,
        );
      }
      const row = ins.rows[0];
      const { eventId } = await enqueueNotificationCreatedOnClient(
        client,
        {
          id: row.id,
          user_id: userId,
          event_type: eventType,
          created_at: row.created_at,
        },
        enriched,
      );
      return {
        inserted: true,
        notificationId: row.id,
        readAt: row.read_at ?? null,
        eventId,
      };
    });
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) throw e;
    // Concurrent insert won — treat as dedupe hit (no outbox from this path).
    return mergeExistingPayload(pool, payloadJson, dk, userId);
  }
}
