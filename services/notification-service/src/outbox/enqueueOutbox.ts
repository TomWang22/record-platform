import type { PoolClient } from "pg";
import { serializeNotificationEvent } from "../notificationKafkaEvents.js";

export type NotificationEventPayload = Record<string, unknown> & {
  metadata: {
    event_id: string;
    event_type: string;
    aggregate_id: string;
    aggregate_type: string;
    producer: string;
    [key: string]: unknown;
  };
};

export type NotificationOutboxEvent = {
  eventId: string;
  /** Kafka key = notification_id (stored in aggregate_id). */
  partitionKey: string;
  type: string;
  version: number;
  payload: NotificationEventPayload;
};

/**
 * Insert one unpublished outbox row on an open transaction client.
 * Never pass a Pool — same-TX guarantee requires PoolClient.
 */
export async function insertNotificationOutboxEvent(
  client: PoolClient,
  event: NotificationOutboxEvent,
): Promise<void> {
  if (!event.eventId) {
    throw new Error("notification_outbox_event_id_missing");
  }
  if (event.payload.metadata?.event_id !== event.eventId) {
    throw new Error(
      `notification_outbox_identity_mismatch:${event.eventId}:${String(
        event.payload.metadata?.event_id,
      )}`,
    );
  }
  if (!event.partitionKey) {
    throw new Error("notification_outbox_partition_key_missing");
  }
  if (!Number.isInteger(event.version) || event.version <= 0) {
    throw new Error("notification_outbox_version_invalid");
  }

  const payloadBytes = serializeNotificationEvent(event.payload);
  const result = await client.query(
    `
      INSERT INTO notification.outbox_events (
        id, aggregate_id, type, version, payload, published
      )
      VALUES ($1::uuid, $2, $3, $4, $5, false)
    `,
    [event.eventId, event.partitionKey, event.type, event.version, payloadBytes],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `notification_outbox_insert_rowcount:${result.rowCount ?? "null"}!=1`,
    );
  }
}
