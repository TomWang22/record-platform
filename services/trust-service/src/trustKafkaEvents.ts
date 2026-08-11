/**
 * Frozen trust.events wire contract (Phase A drain wrap).
 *
 * stored_bytea = trust domain protobuf.
 * kafka_value = events.EventEnvelope wrapping stored_bytea.
 *
 * Drain MUST NOT mint event_id or timestamp. Envelope identity maps from
 * the outbox row: event_id=id, type, version, source=trust-service,
 * entity_id=aggregate_id, timestamp=created_at, payload=exact stored bytes.
 *
 * There are no generated TS protobuf bindings. Encode via protobufjs
 * Type.encode + `@common/utils` resolveProtoPath. keepCase must be passed
 * to Root#loadSync (constructor keepCase and protobuf.loadSync 2nd-arg
 * options do not work).
 *
 * P2 freeze: pending listing reports use ListingFlagSubmittedV1.
 * Peer reviews use PeerReviewCreatedV1. ListingFlaggedV1 / ReviewCreatedV1
 * are not encoded by this module's enqueue helpers.
 * ListingUnflaggedV1 helpers remain for Phase A opaque BYTEA wrap tests.
 */
import { createRequire } from "node:module";
import { resolveProtoPath } from "@common/utils";

const nodeRequire = createRequire(__filename);
// protobufjs is provided transitively by @grpc/proto-loader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const protobuf: any = nodeRequire(
  nodeRequire.resolve("protobufjs", {
    paths: [nodeRequire.resolve("@grpc/proto-loader/package.json")],
  }),
);

export const TRUST_PRODUCER = "trust-service";
export const LISTING_UNFLAGGED_V1 = "ListingUnflaggedV1";
export const LISTING_FLAG_SUBMITTED_V1 = "ListingFlagSubmittedV1";
export const PEER_REVIEW_CREATED_V1 = "PeerReviewCreatedV1";

export type TrustOutboxRowForWrap = {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Buffer;
  created_at: string | Date;
};

type ProtoType = {
  encode: (v: unknown) => { finish: () => Uint8Array };
  decode: (b: Uint8Array) => unknown;
  fromObject: (o: Record<string, unknown>) => unknown;
  toObject: (msg: unknown, opts?: Record<string, unknown>) => Record<string, unknown>;
};

let rootSingleton: { lookupType: (name: string) => ProtoType } | null = null;

function getProtoRoot(): NonNullable<typeof rootSingleton> {
  if (!rootSingleton) {
    // protobuf.loadSync(filename, root) treats the 2nd arg as Root, not parse options.
    // keepCase must be passed to Root#loadSync so event_id is not camelCased to eventId.
    const root = new protobuf.Root();
    root.loadSync(
      [
        resolveProtoPath("events/envelope.proto"),
        resolveProtoPath("events/trust.proto"),
      ],
      { keepCase: true },
    );
    rootSingleton = root;
  }
  return rootSingleton!;
}

export type ListingUnflaggedFields = {
  listing_id: string;
};

export type ListingFlagSubmittedFields = {
  flag_id: string;
  listing_id: string;
  flagged_by: string;
  reason: string;
  description: string;
  submitted_at: string;
};

export type PeerReviewCreatedFields = {
  review_id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string;
  created_at: string;
};

function encodeProto(typeName: string, fields: Record<string, unknown>): Buffer {
  const t = getProtoRoot().lookupType(typeName);
  return Buffer.from(t.encode(t.fromObject(fields)).finish());
}

export function encodeListingUnflaggedV1(fields: ListingUnflaggedFields): Buffer {
  return encodeProto("events.trust.ListingUnflaggedV1", { ...fields });
}

export function decodeListingUnflaggedV1(buf: Buffer): ListingUnflaggedFields {
  const t = getProtoRoot().lookupType("events.trust.ListingUnflaggedV1");
  const obj = t.toObject(t.decode(buf), { defaults: true });
  return {
    listing_id: String(obj.listing_id ?? obj.listingId ?? ""),
  };
}

export function encodeListingFlagSubmittedV1(
  fields: ListingFlagSubmittedFields,
): Buffer {
  return encodeProto("events.trust.ListingFlagSubmittedV1", { ...fields });
}

export function decodeListingFlagSubmittedV1(
  buf: Buffer,
): ListingFlagSubmittedFields {
  const t = getProtoRoot().lookupType("events.trust.ListingFlagSubmittedV1");
  const obj = t.toObject(t.decode(buf), { defaults: true });
  return {
    flag_id: String(obj.flag_id ?? obj.flagId ?? ""),
    listing_id: String(obj.listing_id ?? obj.listingId ?? ""),
    flagged_by: String(obj.flagged_by ?? obj.flaggedBy ?? ""),
    reason: String(obj.reason ?? ""),
    description: String(obj.description ?? ""),
    submitted_at: String(obj.submitted_at ?? obj.submittedAt ?? ""),
  };
}

export function encodePeerReviewCreatedV1(fields: PeerReviewCreatedFields): Buffer {
  return encodeProto("events.trust.PeerReviewCreatedV1", { ...fields });
}

export function decodePeerReviewCreatedV1(buf: Buffer): PeerReviewCreatedFields {
  const t = getProtoRoot().lookupType("events.trust.PeerReviewCreatedV1");
  const obj = t.toObject(t.decode(buf), { defaults: true });
  return {
    review_id: String(obj.review_id ?? obj.reviewId ?? ""),
    booking_id: String(obj.booking_id ?? obj.bookingId ?? ""),
    reviewer_id: String(obj.reviewer_id ?? obj.reviewerId ?? ""),
    reviewee_id: String(obj.reviewee_id ?? obj.revieweeId ?? ""),
    rating: Number(obj.rating ?? 0),
    comment: String(obj.comment ?? ""),
    created_at: String(obj.created_at ?? obj.createdAt ?? ""),
  };
}

function envelopeTimestampFromCreatedAt(createdAt: string | Date): string {
  if (createdAt instanceof Date) {
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("trust_outbox_created_at_missing");
    }
    return createdAt.toISOString();
  }
  if (typeof createdAt === "string" && createdAt.length > 0) {
    return createdAt;
  }
  throw new Error("trust_outbox_created_at_missing");
}

/**
 * Drain wrap: kafka_value = EventEnvelope protobuf.
 * event_id MUST be outbox.id — never mint a UUID here.
 * timestamp MUST be outbox.created_at — never mint wall-clock here.
 */
export function wrapTrustOutboxRowAsEventEnvelope(
  row: TrustOutboxRowForWrap,
): Buffer {
  if (!row.id) {
    throw new Error("trust_outbox_event_id_missing");
  }
  const timestamp = envelopeTimestampFromCreatedAt(row.created_at);
  const payload = Buffer.isBuffer(row.payload)
    ? row.payload
    : Buffer.from(row.payload as Uint8Array);
  const EventEnvelope = getProtoRoot().lookupType("events.EventEnvelope");
  const msg = EventEnvelope.fromObject({
    event_id: row.id,
    type: row.type,
    version: row.version,
    source: TRUST_PRODUCER,
    entity_id: row.aggregate_id,
    timestamp,
    payload,
  });
  return Buffer.from(EventEnvelope.encode(msg).finish());
}

export function decodeTrustEventEnvelope(buf: Buffer): {
  event_id: string;
  type: string;
  version: number;
  source: string;
  entity_id: string;
  timestamp: string;
  payload: Buffer;
} {
  const EventEnvelope = getProtoRoot().lookupType("events.EventEnvelope");
  const obj = EventEnvelope.toObject(EventEnvelope.decode(buf), {
    bytes: "raw",
    defaults: true,
  });
  const payloadRaw = obj.payload;
  const payload = Buffer.isBuffer(payloadRaw)
    ? payloadRaw
    : Buffer.from((payloadRaw as Uint8Array | undefined) ?? []);
  return {
    event_id: String(obj.event_id ?? obj.eventId ?? ""),
    type: String(obj.type ?? ""),
    version: Number(obj.version ?? 0),
    source: String(obj.source ?? ""),
    entity_id: String(obj.entity_id ?? obj.entityId ?? ""),
    timestamp: String(obj.timestamp ?? ""),
    payload,
  };
}
