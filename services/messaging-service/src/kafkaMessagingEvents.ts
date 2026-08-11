/**
 * Kafka events for messaging + forum.
 * Topic: messaging.events.v1 — value is UTF-8 JSON matching versioned proto field names.
 */
import { randomUUID } from "node:crypto";
import { buildKafkaMessageHeaders, withKafkaProduceSpan } from "@common/utils/otel";

export const MESSAGING_EVENTS_TOPIC = "messaging.events.v1";

const PRODUCER = "messaging-service";
const SCHEMA_VERSION = "1";

export type EventMetadataJson = {
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

export type BuildMetadataParams = {
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  event_id?: string;
  correlation_id?: string;
  causation_id?: string;
};

export function buildMetadata(params: BuildMetadataParams): EventMetadataJson {
  return {
    event_id: params.event_id ?? randomUUID(),
    event_type: params.event_type,
    aggregate_id: params.aggregate_id,
    aggregate_type: params.aggregate_type,
    occurred_at: new Date().toISOString(),
    correlation_id: params.correlation_id ?? "",
    causation_id: params.causation_id ?? "",
    producer: PRODUCER,
    version: SCHEMA_VERSION,
  };
}

/** Canonical messaging.events.v1 wire encoding (UTF-8 JSON). */
export function serializeMessagingEvent(payload: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

type MessagingProducer = {
  send: (args: {
    topic: string;
    messages: Array<{
      key: string;
      value: string | Buffer;
      headers?: Record<string, Buffer>;
    }>;
  }) => Promise<unknown>;
};

/**
 * Legacy direct producer retained only for event types not yet migrated
 * to the transactional outbox (update/delete/read, forum).
 */
export async function sendMessagingEvent(
  producer: MessagingProducer,
  partitionKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const serialized = serializeMessagingEvent(payload);
  await withKafkaProduceSpan(
    `kafka produce ${MESSAGING_EVENTS_TOPIC}`,
    {
      "messaging.system": "kafka",
      "messaging.destination.name": MESSAGING_EVENTS_TOPIC,
    },
    async () => {
      await producer.send({
        topic: MESSAGING_EVENTS_TOPIC,
        messages: [
          {
            key: partitionKey,
            value: serialized,
            headers: buildKafkaMessageHeaders(),
          },
        ],
      });
    },
  );
}
