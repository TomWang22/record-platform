/**
 * Transactional outbox for auction bid events → Kafka (dev.listing.events).
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { LISTING_EVENTS_TOPIC, publishListingEvent } from "./listing-kafka.js";

export type AuctionKafkaEventType =
  | "BidPlaced"
  | "AuctionOutbid"
  | "AuctionEndingSoon"
  | "AuctionEnded"
  | "AuctionWon"
  | "AuctionLost"
  | "AuctionSold";

export async function insertAuctionOutboxRow(
  client: PoolClient,
  input: {
    eventId: string;
    aggregateId: string;
    eventType: AuctionKafkaEventType;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const payloadJson = JSON.stringify({
    metadata: {
      event_id: input.eventId,
      event_type: input.eventType,
      aggregate_id: input.aggregateId,
      aggregate_type: "auction",
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

export async function publishAuctionOutboxAndKafka(input: {
  eventId: string;
  listingId: string;
  eventType: AuctionKafkaEventType;
  payload: Record<string, unknown>;
}): Promise<void> {
  await publishListingEvent(
    input.eventType,
    input.listingId,
    {
      listing_id: input.listingId,
      ...input.payload,
    },
    input.eventId,
  );
}

export async function markAuctionOutboxPublished(
  client: PoolClient,
  eventId: string,
): Promise<void> {
  await client.query(`UPDATE listings.outbox_events SET published = true WHERE id = $1::uuid`, [
    eventId,
  ]);
}

export function newAuctionEventId(): string {
  return randomUUID();
}

export { LISTING_EVENTS_TOPIC };
