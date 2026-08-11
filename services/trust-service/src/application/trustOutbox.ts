/**
 * Shared trust write services: one covered domain mutation +
 * trust.outbox_events INSERT on the same PoolClient transaction.
 *
 * event_id is minted once before BEGIN. Drain must not remint.
 * HTTP/gRPC listing-flag + peer-review writers call these helpers.
 * ListingFlaggedV1 / ReviewCreatedV1 are not produced here.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  LISTING_FLAG_SUBMITTED_V1,
  PEER_REVIEW_CREATED_V1,
  encodeListingFlagSubmittedV1,
  encodePeerReviewCreatedV1,
} from "../trustKafkaEvents.js";
import { insertTrustOutboxEvent } from "../outbox/enqueueOutbox.js";
import {
  runTrustEnqueueTransaction,
  type TrustEnqueueResult,
} from "../outbox/trustEnqueueTx.js";

export function mintTrustEventId(): string {
  return randomUUID();
}

function iso(value: Date | string | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("trust_outbox_timestamp_invalid");
    }
    return value.toISOString();
  }
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

export type InsertListingFlagSubmittedInput = {
  listingId: string;
  flaggedBy: string;
  reason: string;
  description?: string | null;
  eventId?: string;
  at?: string;
};

export type InsertListingFlagSubmittedValue = {
  flagId: string;
  eventId: string;
  status: string;
};

export async function insertListingFlagSubmittedWithOutbox(
  pool: Pool,
  input: InsertListingFlagSubmittedInput,
): Promise<TrustEnqueueResult<InsertListingFlagSubmittedValue>> {
  const eventId = input.eventId ?? mintTrustEventId();
  const at = iso(input.at);
  return runTrustEnqueueTransaction(
    pool,
    async (client) => {
      const inserted = await client.query<{ id: string; status: string }>(
        `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason, description)
         VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
        [input.listingId, input.flaggedBy, input.reason, input.description ?? null],
      );
      const flagId = String(inserted.rows[0]?.id ?? "");
      if (!flagId) {
        throw new Error("trust_listing_flag_id_missing");
      }
      const payload = encodeListingFlagSubmittedV1({
        flag_id: flagId,
        listing_id: input.listingId,
        flagged_by: input.flaggedBy,
        reason: input.reason,
        description: input.description ?? "",
        submitted_at: at,
      });
      await insertTrustOutboxEvent(client, {
        eventId,
        aggregateId: input.listingId,
        type: LISTING_FLAG_SUBMITTED_V1,
        version: 1,
        payload,
      });
      return {
        flagId,
        eventId,
        status: String(inserted.rows[0]?.status ?? "pending"),
      };
    },
    (value) => ({
      eventId: value.eventId,
      domain: { kind: "listing_flag_submitted", flagId: value.flagId },
    }),
  );
}

export type InsertPeerReviewCreatedInput = {
  bookingId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  comment?: string | null;
  eventId?: string;
  at?: string;
};

export type InsertPeerReviewCreatedValue = {
  reviewId: string;
  eventId: string;
};

export async function insertPeerReviewCreatedWithOutbox(
  pool: Pool,
  input: InsertPeerReviewCreatedInput,
): Promise<TrustEnqueueResult<InsertPeerReviewCreatedValue>> {
  const eventId = input.eventId ?? mintTrustEventId();
  const at = iso(input.at);
  return runTrustEnqueueTransaction(
    pool,
    async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO trust.reviews (booking_id, reviewer_id, target_type, target_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, 'user'::trust.review_target_type, $3::uuid, $4, $5) RETURNING id`,
        [input.bookingId, input.reviewerId, input.revieweeId, input.rating, input.comment ?? null],
      );
      const reviewId = String(inserted.rows[0]?.id ?? "");
      if (!reviewId) {
        throw new Error("trust_review_id_missing");
      }
      const payload = encodePeerReviewCreatedV1({
        review_id: reviewId,
        booking_id: input.bookingId,
        reviewer_id: input.reviewerId,
        reviewee_id: input.revieweeId,
        rating: input.rating,
        comment: input.comment ?? "",
        created_at: at,
      });
      await insertTrustOutboxEvent(client, {
        eventId,
        aggregateId: reviewId,
        type: PEER_REVIEW_CREATED_V1,
        version: 1,
        payload,
      });
      return { reviewId, eventId };
    },
    (value) => ({
      eventId: value.eventId,
      domain: { kind: "peer_review_created", reviewId: value.reviewId },
    }),
  );
}
