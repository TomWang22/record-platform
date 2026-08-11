/**
 * Frozen notification.events wire contract (Phase B):
 * UTF-8 JSON envelope — matches extractNotificationEnvelopeMeta decoder.
 * Not protobuf EventEnvelope.
 */
import { randomUUID } from "node:crypto";

export const NOTIFICATION_PRODUCER = "notification-service";
export const NOTIFICATION_CREATED_V1 = "NotificationCreatedV1";
export const NOTIFICATION_CREATED_EVENT_TYPE = "NotificationCreated";
export const SCHEMA_VERSION = "1";

export type NotificationEventMetadata = {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  occurred_at: string;
  correlation_id: string;
  causation_id: string;
  producer: string;
  version: string;
};

export type BuildNotificationMetadataParams = {
  event_type: string;
  aggregate_id: string;
  aggregate_type?: string;
  event_id: string;
  correlation_id?: string;
  causation_id?: string;
};

export function buildNotificationMetadata(
  params: BuildNotificationMetadataParams,
): NotificationEventMetadata {
  if (!params.event_id) {
    throw new Error("notification_event_id_required");
  }
  return {
    event_id: params.event_id,
    event_type: params.event_type,
    aggregate_id: params.aggregate_id,
    aggregate_type: params.aggregate_type ?? "notification",
    occurred_at: new Date().toISOString(),
    correlation_id: params.correlation_id ?? "",
    causation_id: params.causation_id ?? "",
    producer: NOTIFICATION_PRODUCER,
    version: SCHEMA_VERSION,
  };
}

/** Canonical notification.events UTF-8 JSON bytes. */
export function serializeNotificationEvent(payload: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export function mintNotificationEventId(): string {
  return randomUUID();
}

export type ParsedNotificationEnvelope = {
  raw: Record<string, unknown>;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
  eventType: string;
  producer: string;
  /** Frozen identity when present; null when missing (Track C fail-closed). */
  eventId: string | null;
  missingEventId: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parse UTF-8 JSON envelope without manufacturing identity.
 * Missing event_id ⇒ missingEventId=true, eventId=null (never randomUUID).
 */
export function parseNotificationEnvelope(buf: Buffer): ParsedNotificationEnvelope | null {
  try {
    const raw = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
    const metadata = (raw.metadata as Record<string, unknown>) || {};
    const payload = (raw.payload as Record<string, unknown>) || {};
    const eventType = String(
      raw.type || raw.event_type || metadata.event_type || metadata.type || "domain.event",
    );
    const producer = String(metadata.producer || raw.producer || "").trim();
    const candidate = String(metadata.event_id || raw.event_id || raw.id || "").trim();
    const eventId = UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
    return {
      raw,
      metadata,
      payload,
      eventType,
      producer,
      eventId,
      missingEventId: !eventId,
    };
  } catch {
    return null;
  }
}

/**
 * Self-emitted NotificationCreatedV1 from this service must not re-enter inbox create.
 * Requires BOTH producer and event type.
 */
export function isSelfEmittedNotificationCreated(
  parsed: Pick<ParsedNotificationEnvelope, "producer" | "eventType">,
): boolean {
  const type = String(parsed.eventType || "").trim();
  const isCreated =
    type === NOTIFICATION_CREATED_V1 ||
    type === NOTIFICATION_CREATED_EVENT_TYPE ||
    type === "NotificationCreatedV1";
  return parsed.producer === NOTIFICATION_PRODUCER && isCreated;
}
