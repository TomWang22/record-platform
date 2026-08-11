/**
 * Insert one unpublished records.outbox_events row on an open Prisma transaction.
 * Never pass a second Pool — same-TX guarantee requires the Prisma tx client.
 *
 * stored BYTEA = Record{Created,Updated,Deleted}V1 protobuf (not JSON, not EventEnvelope).
 */
import {
  RECORD_CREATED_V1,
  RECORD_DELETED_V1,
  RECORD_UPDATED_V1,
  type RecordsOutboxEventType,
} from "../recordsKafkaEvents.js";

export type RecordsOutboxTx = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number | bigint>;
};

export type RecordsOutboxInsert = {
  eventId: string;
  aggregateId: string;
  type: RecordsOutboxEventType;
  version: number;
  payload: Buffer;
};

const ALLOWED_TYPES = new Set<string>([
  RECORD_CREATED_V1,
  RECORD_UPDATED_V1,
  RECORD_DELETED_V1,
]);

export async function insertRecordsOutboxEvent(
  tx: RecordsOutboxTx,
  event: RecordsOutboxInsert,
): Promise<void> {
  if (!event.eventId) {
    throw new Error("records_outbox_event_id_missing");
  }
  if (!event.aggregateId) {
    throw new Error("records_outbox_aggregate_id_missing");
  }
  if (!ALLOWED_TYPES.has(event.type)) {
    throw new Error(`records_outbox_type_invalid:${event.type}`);
  }
  if (!Number.isInteger(event.version) || event.version <= 0) {
    throw new Error("records_outbox_version_invalid");
  }
  if (!Buffer.isBuffer(event.payload)) {
    throw new Error("records_outbox_payload_not_buffer");
  }

  const rowCount = Number(
    await tx.$executeRaw`
      INSERT INTO records.outbox_events (
        id, aggregate_id, type, version, payload, published
      )
      VALUES (
        ${event.eventId}::uuid,
        ${event.aggregateId},
        ${event.type},
        ${event.version},
        ${event.payload},
        false
      )
    `,
  );

  if (rowCount !== 1) {
    throw new Error(`records_outbox_insert_rowcount:${rowCount}!=1`);
  }
}
