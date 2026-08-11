/**
 * P2 proto freeze: ListingFlagSubmittedV1 + PeerReviewCreatedV1 round-trips.
 * Semantic guards: pending writers must not encode ListingFlaggedV1;
 * peer-review writers must not encode ReviewCreatedV1.
 * HTTP/gRPC listing-flag + peer-review writers enqueue via helpers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LISTING_FLAG_SUBMITTED_V1,
  PEER_REVIEW_CREATED_V1,
  decodeListingFlagSubmittedV1,
  decodePeerReviewCreatedV1,
  encodeListingFlagSubmittedV1,
  encodePeerReviewCreatedV1,
} from "../src/trustKafkaEvents.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const FLAG_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "33333333-3333-4333-8333-333333333333";
const REVIEW_ID = "44444444-4444-4444-8444-444444444444";
const BOOKING_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWEE_ID = "66666666-6666-4666-8666-666666666666";
const AT = "2026-08-11T15:00:00.000Z";

describe("ListingFlagSubmittedV1 round-trip", () => {
  it("encodes pending submission fields; listing_id is not a confirmation event", () => {
    const fields = {
      flag_id: FLAG_ID,
      listing_id: LISTING_ID,
      flagged_by: REVIEWER_ID,
      reason: "counterfeit",
      description: "sleeve mismatch",
      submitted_at: AT,
    };
    const bytes = encodeListingFlagSubmittedV1(fields);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(0);
    expect(decodeListingFlagSubmittedV1(bytes)).toEqual(fields);
    expect(LISTING_FLAG_SUBMITTED_V1).toBe("ListingFlagSubmittedV1");
    expect(LISTING_FLAG_SUBMITTED_V1).not.toBe("ListingFlaggedV1");
  });
});

describe("PeerReviewCreatedV1 round-trip", () => {
  it("keeps booking_id as booking_id; target maps to reviewee_id; no listing/order ids", () => {
    const fields = {
      review_id: REVIEW_ID,
      booking_id: BOOKING_ID,
      reviewer_id: REVIEWER_ID,
      reviewee_id: REVIEWEE_ID,
      rating: 5,
      comment: "[host] great stay",
      created_at: AT,
    };
    const bytes = encodePeerReviewCreatedV1(fields);
    const decoded = decodePeerReviewCreatedV1(bytes);
    expect(decoded).toEqual(fields);
    expect(decoded.booking_id).toBe(BOOKING_ID);
    expect(decoded.reviewee_id).toBe(REVIEWEE_ID);
    expect(decoded).not.toHaveProperty("listing_id");
    expect(decoded).not.toHaveProperty("order_id");
    expect(PEER_REVIEW_CREATED_V1).toBe("PeerReviewCreatedV1");
    expect(PEER_REVIEW_CREATED_V1).not.toBe("ReviewCreatedV1");
  });
});

describe("semantic guards — proto + writers", () => {
  it("repo and k8s trust event protos both declare the two new messages", () => {
    const proto = readFileSync(join(REPO, "proto/events/trust.proto"), "utf8");
    const mirror = readFileSync(
      join(REPO, "infra/k8s/base/config/proto/events/trust.proto"),
      "utf8",
    );
    for (const src of [proto, mirror]) {
      expect(src).toMatch(/message ListingFlagSubmittedV1/);
      expect(src).toMatch(/message PeerReviewCreatedV1/);
      expect(src).toMatch(/string booking_id = 2;/);
      expect(src).toMatch(/message ListingFlaggedV1/);
      expect(src).toMatch(/message ReviewCreatedV1/);
    }
  });

  it("pending HTTP/gRPC listing-flag writers do not encode ListingFlaggedV1", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).not.toMatch(/ListingFlaggedV1/);
    expect(grpc).not.toMatch(/ListingFlaggedV1/);
    expect(http).not.toMatch(/encodeListingFlaggedV1/);
    expect(grpc).not.toMatch(/encodeListingFlaggedV1/);
  });

  it("peer-review HTTP/gRPC writers do not encode ReviewCreatedV1", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).not.toMatch(/ReviewCreatedV1/);
    expect(grpc).not.toMatch(/ReviewCreatedV1/);
    expect(http).not.toMatch(/encodeReviewCreatedV1/);
    expect(grpc).not.toMatch(/encodeReviewCreatedV1/);
  });

  it("HTTP/gRPC listing-flag + peer-review paths call enqueue helpers", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(http).toMatch(/insertPeerReviewCreatedWithOutbox/);
    expect(grpc).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(grpc).toMatch(/insertPeerReviewCreatedWithOutbox/);
    expect(http).not.toMatch(/runTrustEnqueueTransaction/);
    expect(grpc).not.toMatch(/runTrustEnqueueTransaction/);
  });
});
