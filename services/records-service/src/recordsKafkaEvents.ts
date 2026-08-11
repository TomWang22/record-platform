/**
 * Frozen records.events wire contract (Phase A drain wrap).
 *
 * There are no generated TS protobuf bindings in this repo for EventEnvelope /
 * Record*V1. The established import path is protobufjs Type.encode via
 * `@common/utils` `resolveProtoPath` (same as user-lifecycle-kafka.ts).
 * Do not hand-roll protobuf wire bytes.
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

export const RECORDS_PRODUCER = "records-service";
export const RECORD_CREATED_V1 = "RecordCreatedV1";
export const RECORD_UPDATED_V1 = "RecordUpdatedV1";
export const RECORD_DELETED_V1 = "RecordDeletedV1";

export type RecordsOutboxEventType =
  | typeof RECORD_CREATED_V1
  | typeof RECORD_UPDATED_V1
  | typeof RECORD_DELETED_V1;

export type RecordsOutboxRowForWrap = {
  id: string;
  aggregate_id: string;
  type: string;
  version: number;
  payload: Buffer;
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
        resolveProtoPath("events/records.proto"),
      ],
      { keepCase: true },
    );
    rootSingleton = root;
  }
  return rootSingleton!;
}

export type RecordCreatedFields = {
  record_id: string;
  user_id: string;
  created_at: string;
};

export type RecordUpdatedFields = {
  record_id: string;
  user_id: string;
  updated_at: string;
};

export type RecordDeletedFields = {
  record_id: string;
  user_id: string;
  deleted_at: string;
};

function encodeProto(typeName: string, fields: Record<string, unknown>): Buffer {
  const t = getProtoRoot().lookupType(typeName);
  return Buffer.from(t.encode(t.fromObject(fields)).finish());
}

export function encodeRecordCreatedV1(fields: RecordCreatedFields): Buffer {
  return encodeProto("events.records.RecordCreatedV1", { ...fields });
}

export function encodeRecordUpdatedV1(fields: RecordUpdatedFields): Buffer {
  return encodeProto("events.records.RecordUpdatedV1", { ...fields });
}

export function encodeRecordDeletedV1(fields: RecordDeletedFields): Buffer {
  return encodeProto("events.records.RecordDeletedV1", { ...fields });
}

export function decodeRecordCreatedV1(buf: Buffer): RecordCreatedFields {
  const t = getProtoRoot().lookupType("events.records.RecordCreatedV1");
  const obj = t.toObject(t.decode(buf), { defaults: true });
  return {
    record_id: String(obj.record_id ?? obj.recordId ?? ""),
    user_id: String(obj.user_id ?? obj.userId ?? ""),
    created_at: String(obj.created_at ?? obj.createdAt ?? ""),
  };
}

export function encodeRecordsDomainPayload(
  type: RecordsOutboxEventType,
  fields: { record_id: string; user_id: string; at: string },
): Buffer {
  switch (type) {
    case RECORD_CREATED_V1:
      return encodeRecordCreatedV1({
        record_id: fields.record_id,
        user_id: fields.user_id,
        created_at: fields.at,
      });
    case RECORD_UPDATED_V1:
      return encodeRecordUpdatedV1({
        record_id: fields.record_id,
        user_id: fields.user_id,
        updated_at: fields.at,
      });
    case RECORD_DELETED_V1:
      return encodeRecordDeletedV1({
        record_id: fields.record_id,
        user_id: fields.user_id,
        deleted_at: fields.at,
      });
    default: {
      const _never: never = type;
      throw new Error(`records_event_type_unhandled:${String(_never)}`);
    }
  }
}

/**
 * Drain wrap: kafka_value = EventEnvelope protobuf.
 * event_id MUST be outbox.id — never mint a UUID here.
 */
export function wrapRecordsOutboxRowAsEventEnvelope(row: RecordsOutboxRowForWrap): Buffer {
  if (!row.id) {
    throw new Error("records_outbox_event_id_missing");
  }
  const payload = Buffer.isBuffer(row.payload)
    ? row.payload
    : Buffer.from(row.payload as Uint8Array);
  const EventEnvelope = getProtoRoot().lookupType("events.EventEnvelope");
  const msg = EventEnvelope.fromObject({
    event_id: row.id,
    type: row.type,
    version: row.version,
    source: RECORDS_PRODUCER,
    entity_id: row.aggregate_id,
    payload,
  });
  return Buffer.from(EventEnvelope.encode(msg).finish());
}

export function decodeRecordsEventEnvelope(buf: Buffer): {
  event_id: string;
  type: string;
  version: number;
  source: string;
  entity_id: string;
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
    payload,
  };
}
