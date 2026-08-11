/**
 * Insert one unpublished trust.outbox_events row on an open PoolClient.
 * Never pass a Pool — same-TX guarantee requires PoolClient.
 *
 * stored BYTEA = frozen ListingFlagSubmittedV1 / PeerReviewCreatedV1 protobuf
 * (not JSON, not EventEnvelope).
 *
 * ListingFlaggedV1 and ReviewCreatedV1 are rejected: pending flags and
 * peer reviews must not reuse those confirmation/listing-order messages.
 */
import type { PoolClient } from "pg";
import {
  LISTING_FLAG_SUBMITTED_V1,
  PEER_REVIEW_CREATED_V1,
} from "../trustKafkaEvents.js";

export type TrustOutboxInsert = {
  eventId: string;
  aggregateId: string;
  type: string;
  version: number;
  payload: Buffer;
};

const ALLOWED_TYPES = new Set<string>([
  LISTING_FLAG_SUBMITTED_V1,
  PEER_REVIEW_CREATED_V1,
]);

export async function insertTrustOutboxEvent(
  client: PoolClient,
  event: TrustOutboxInsert,
): Promise<void> {
  if (!event.eventId) {
    throw new Error("trust_outbox_event_id_missing");
  }
  if (!event.aggregateId) {
    throw new Error("trust_outbox_aggregate_id_missing");
  }
  if (!ALLOWED_TYPES.has(event.type)) {
    throw new Error(`trust_outbox_type_invalid:${event.type}`);
  }
  if (!Number.isInteger(event.version) || event.version <= 0) {
    throw new Error("trust_outbox_version_invalid");
  }
  if (!Buffer.isBuffer(event.payload)) {
    throw new Error("trust_outbox_payload_not_buffer");
  }

  const result = await client.query(
    `
      INSERT INTO trust.outbox_events (
        id, aggregate_id, type, version, payload, published
      )
      VALUES ($1::uuid, $2, $3, $4, $5, false)
    `,
    [event.eventId, event.aggregateId, event.type, event.version, event.payload],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      `trust_outbox_insert_rowcount:${result.rowCount ?? "null"}!=1`,
    );
  }
}
