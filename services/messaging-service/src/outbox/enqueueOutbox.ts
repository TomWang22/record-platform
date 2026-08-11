import type { PoolClient } from "pg";
import { serializeMessagingEvent } from "../kafkaMessagingEvents.js";

export type MessagingEventPayload = Record<string, unknown> & {
  metadata: {
    event_id: string;
    event_type: string;
    aggregate_id: string;
    aggregate_type: string;
    [key: string]: unknown;
  };
};

export type MessagingOutboxEvent = {
  eventId: string;
  /** Frozen Kafka partition key for messaging.events.v1 (stored in aggregate_id). */
  partitionKey: string;
  type: string;
  version: number;
  payload: MessagingEventPayload;
};

/**
 * Insert one unpublished outbox row on an open transaction client.
 * Never pass a Pool — same-TX guarantee requires PoolClient.
 */
export async function insertMessagingOutboxEvent(
  client: PoolClient,
  event: MessagingOutboxEvent,
): Promise<void> {
  if (!event.eventId) {
    throw new Error("messaging_outbox_event_id_missing");
  }
  if (event.payload.metadata?.event_id !== event.eventId) {
    throw new Error(
      `messaging_outbox_identity_mismatch:${event.eventId}:${String(
        event.payload.metadata?.event_id,
      )}`,
    );
  }
  if (!event.partitionKey) {
    throw new Error("messaging_outbox_partition_key_missing");
  }
  if (!Number.isInteger(event.version) || event.version <= 0) {
    throw new Error("messaging_outbox_version_invalid");
  }

  const payloadBytes = serializeMessagingEvent(event.payload);
  const result = await client.query(
    `
      INSERT INTO messaging.outbox_events (
        id, aggregate_id, type, version, payload, published
      )
      VALUES ($1::uuid, $2, $3, $4, $5, false)
    `,
    [event.eventId, event.partitionKey, event.type, event.version, payloadBytes],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `messaging_outbox_insert_rowcount:${result.rowCount ?? "null"}!=1`,
    );
  }
}
