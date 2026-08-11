/**
 * Insert one unpublished shopping.outbox_events row on an open PoolClient.
 * Never pass a Pool — same-TX guarantee requires PoolClient.
 *
 * stored BYTEA = frozen Shopping*V1 protobuf (not JSON, not EventEnvelope).
 */
import type { PoolClient } from "pg";
import {
  CART_UPDATED_V1,
  ORDER_CREATED_V1,
  ORDER_PAID_V1,
  SHIPMENT_CREATED_V1,
  WATCHLIST_CHANGED_V1,
} from "../shoppingKafkaEvents.js";

export type ShoppingOutboxInsert = {
  eventId: string;
  aggregateId: string;
  type: string;
  version: number;
  payload: Buffer;
};

const ALLOWED_TYPES = new Set<string>([
  CART_UPDATED_V1,
  WATCHLIST_CHANGED_V1,
  ORDER_CREATED_V1,
  ORDER_PAID_V1,
  SHIPMENT_CREATED_V1,
]);

export async function insertShoppingOutboxEvent(
  client: PoolClient,
  event: ShoppingOutboxInsert,
): Promise<void> {
  if (!event.eventId) {
    throw new Error("shopping_outbox_event_id_missing");
  }
  if (!event.aggregateId) {
    throw new Error("shopping_outbox_aggregate_id_missing");
  }
  if (!ALLOWED_TYPES.has(event.type)) {
    throw new Error(`shopping_outbox_type_invalid:${event.type}`);
  }
  if (!Number.isInteger(event.version) || event.version <= 0) {
    throw new Error("shopping_outbox_version_invalid");
  }
  if (!Buffer.isBuffer(event.payload)) {
    throw new Error("shopping_outbox_payload_not_buffer");
  }

  const result = await client.query(
    `
      INSERT INTO shopping.outbox_events (
        id, aggregate_id, type, version, payload, published
      )
      VALUES ($1::uuid, $2, $3, $4, $5, false)
    `,
    [event.eventId, event.aggregateId, event.type, event.version, event.payload],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `shopping_outbox_insert_rowcount:${result.rowCount ?? "null"}!=1`,
    );
  }
}
