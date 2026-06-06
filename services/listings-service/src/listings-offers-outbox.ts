/**
 * Transactional outbox for OBO offer events → Kafka (dev.listing.events).
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { LISTING_EVENTS_TOPIC, publishListingEvent } from "./listing-kafka.js";

export type OfferKafkaEventType =
  | "OfferCreated"
  | "OfferCountered"
  | "OfferAccepted"
  | "OfferRejected"
  | "OfferWithdrawn"
  | "OfferExpired";

export async function insertOfferOutboxRow(
  client: PoolClient,
  input: {
    eventId: string;
    aggregateId: string;
    eventType: OfferKafkaEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const payloadJson = JSON.stringify({
    metadata: {
      event_id: input.eventId,
      event_type: input.eventType,
      aggregate_id: input.aggregateId,
      aggregate_type: "offer",
      occurred_at: new Date().toISOString(),
      producer: "listings-service",
      version: "1",
    },
    payload: input.payload,
  });
  await client.query(
    `INSERT INTO listings.outbox_events (id, aggregate_id, type, version, payload, published)
     VALUES ($1::uuid, $2, $3, 1, $4::bytea, false)`,
    [input.eventId, input.aggregateId, input.eventType, Buffer.from(payloadJson, "utf8")],
  );
}

export async function publishOfferOutboxAndKafka(input: {
  eventId: string;
  offerId: string;
  listingId: string;
  eventType: OfferKafkaEventType;
  payload: Record<string, unknown>;
}): Promise<void> {
  await publishListingEvent(input.eventType, input.offerId, {
    offer_id: input.offerId,
    listing_id: input.listingId,
    ...input.payload,
  }, input.eventId);
}

export async function markOfferOutboxPublished(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE listings.outbox_events SET published = true WHERE id = $1::uuid`,
    [eventId],
  );
}

export function newOfferEventId(): string {
  return randomUUID();
}

export { LISTING_EVENTS_TOPIC };
