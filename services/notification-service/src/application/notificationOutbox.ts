/**
 * Shared create application service: domain insert + notification.outbox_events
 * in one transaction. Emits NotificationCreatedV1 only (not NotificationSentV1).
 */
import type { Pool, PoolClient } from "pg";
import {
  NOTIFICATION_CREATED_EVENT_TYPE,
  NOTIFICATION_CREATED_V1,
  buildNotificationMetadata,
  mintNotificationEventId,
  type NotificationEventMetadata,
} from "../notificationKafkaEvents.js";
import {
  insertNotificationOutboxEvent,
  type NotificationEventPayload,
} from "../outbox/enqueueOutbox.js";
import { withNotificationTransaction } from "../lib/transaction.js";

export type NotificationRow = {
  id: string;
  user_id: string;
  event_type: string;
  created_at: Date | string;
};

export type CreateNotificationInput = {
  userId: string;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
  readAt?: string | Date | null;
  correlationId?: string;
  causationId?: string;
};

export type NotificationWriteResult = {
  notification: NotificationRow;
  eventId: string;
  partitionKey: string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function buildCreatedPayload(
  notification: NotificationRow,
  metadata: NotificationEventMetadata,
  domainPayload: Record<string, unknown>,
): NotificationEventPayload {
  return {
    metadata,
    notification_id: notification.id,
    user_id: notification.user_id,
    type: notification.event_type,
    created_at: iso(notification.created_at),
    payload: domainPayload,
  };
}

async function enqueueCreated(
  client: PoolClient,
  notification: NotificationRow,
  domainPayload: Record<string, unknown>,
  opts?: { correlationId?: string; causationId?: string },
): Promise<{ eventId: string; partitionKey: string }> {
  const eventId = mintNotificationEventId();
  const partitionKey = notification.id;
  const metadata = buildNotificationMetadata({
    event_id: eventId,
    event_type: NOTIFICATION_CREATED_EVENT_TYPE,
    aggregate_id: partitionKey,
    aggregate_type: "notification",
    correlation_id: opts?.correlationId,
    causation_id: opts?.causationId,
  });
  const payload = buildCreatedPayload(notification, metadata, domainPayload);
  await insertNotificationOutboxEvent(client, {
    eventId,
    partitionKey,
    type: NOTIFICATION_CREATED_V1,
    version: 1,
    payload,
  });
  return { eventId, partitionKey };
}

/**
 * Insert a notification row and enqueue NotificationCreatedV1 in the same TX.
 * Does not emit NotificationSentV1.
 */
export async function createNotificationWithOutbox(
  pool: Pool,
  input: CreateNotificationInput,
): Promise<NotificationWriteResult> {
  return withNotificationTransaction(pool, async (client) => {
    const payloadJson = JSON.stringify(input.payload);
    const result = await client.query<NotificationRow>(
      `
        INSERT INTO notification.notifications (
          user_id, event_type, channel, status, payload, dedupe_key, read_at
        )
        VALUES (
          $1::uuid,
          $2,
          'push'::notification.notification_channel,
          'pending',
          $3::jsonb,
          $4,
          $5::timestamptz
        )
        RETURNING id::text, user_id::text, event_type, created_at
      `,
      [
        input.userId,
        input.eventType.slice(0, 120),
        payloadJson,
        input.dedupeKey ?? null,
        input.readAt ?? null,
      ],
    );
    if (result.rowCount !== 1 || !result.rows[0]) {
      throw new Error(
        `notification_domain_insert_rowcount:${result.rowCount ?? "null"}!=1`,
      );
    }
    const notification = result.rows[0];
    const { eventId, partitionKey } = await enqueueCreated(
      client,
      notification,
      input.payload,
      {
        correlationId: input.correlationId,
        causationId: input.causationId,
      },
    );
    return { notification, eventId, partitionKey };
  });
}

/** Enqueue NotificationCreatedV1 for an already-inserted row on an open client. */
export async function enqueueNotificationCreatedOnClient(
  client: PoolClient,
  notification: NotificationRow,
  domainPayload: Record<string, unknown>,
  opts?: { correlationId?: string; causationId?: string },
): Promise<{ eventId: string; partitionKey: string }> {
  return enqueueCreated(client, notification, domainPayload, opts);
}
