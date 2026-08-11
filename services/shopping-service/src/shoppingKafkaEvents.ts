/**
 * Frozen shopping.events wire contract (Phase A drain wrap).
 *
 * stored_bytea = shopping domain protobuf.
 * kafka_value = events.EventEnvelope wrapping stored_bytea.
 *
 * Drain MUST NOT mint event_id or timestamp. Envelope identity maps from
 * the outbox row: event_id=id, type, version, source=shopping-service,
 * entity_id=aggregate_id, timestamp=created_at, payload=exact stored bytes.
 *
 * There are no generated TS protobuf bindings. Encode via protobufjs
 * Type.encode + `@common/utils` resolveProtoPath. keepCase must be passed
 * to Root#loadSync (constructor keepCase and protobuf.loadSync 2nd-arg
 * options do not work).
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

export const SHOPPING_PRODUCER = "shopping-service";
export const CART_UPDATED_V1 = "CartUpdatedV1";
export const WATCHLIST_CHANGED_V1 = "WatchlistChangedV1";
export const ORDER_CREATED_V1 = "OrderCreatedV1";
export const ORDER_PAID_V1 = "OrderPaidV1";
export const SHIPMENT_CREATED_V1 = "ShipmentCreatedV1";

export type ShoppingOutboxEventType =
  | typeof CART_UPDATED_V1
  | typeof WATCHLIST_CHANGED_V1
  | typeof ORDER_CREATED_V1
  | typeof ORDER_PAID_V1
  | typeof SHIPMENT_CREATED_V1;

export type ShoppingOutboxRowForWrap = {
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
        resolveProtoPath("events/shopping.proto"),
      ],
      { keepCase: true },
    );
    rootSingleton = root;
  }
  return rootSingleton!;
}

export type CartUpdatedFields = {
  user_id: string;
  cart_item_id: string;
  item_type: string;
  item_id: string;
  updated_at: string;
};

export type WatchlistChangedFields = {
  user_id: string;
  item_type: string;
  item_id: string;
  action: "added" | "removed";
  changed_at: string;
};

export type OrderCreatedFields = {
  order_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  listing_id: string;
  total_cents: number;
  currency: string;
  created_at: string;
};

export type OrderPaidFields = {
  order_id: string;
  paid_at: string;
  payment_ref: string;
};

export type ShipmentCreatedFields = {
  shipment_id: string;
  order_id: string;
  carrier: string;
  created_at: string;
};

function encodeProto(typeName: string, fields: Record<string, unknown>): Buffer {
  const t = getProtoRoot().lookupType(typeName);
  return Buffer.from(t.encode(t.fromObject(fields)).finish());
}

export function encodeCartUpdatedV1(fields: CartUpdatedFields): Buffer {
  return encodeProto("events.shopping.CartUpdatedV1", { ...fields });
}

export function decodeCartUpdatedV1(buf: Buffer): CartUpdatedFields {
  const t = getProtoRoot().lookupType("events.shopping.CartUpdatedV1");
  const obj = t.toObject(t.decode(buf), { defaults: true });
  return {
    user_id: String(obj.user_id ?? obj.userId ?? ""),
    cart_item_id: String(obj.cart_item_id ?? obj.cartItemId ?? ""),
    item_type: String(obj.item_type ?? obj.itemType ?? ""),
    item_id: String(obj.item_id ?? obj.itemId ?? ""),
    updated_at: String(obj.updated_at ?? obj.updatedAt ?? ""),
  };
}

export function encodeWatchlistChangedV1(fields: WatchlistChangedFields): Buffer {
  return encodeProto("events.shopping.WatchlistChangedV1", { ...fields });
}

export function encodeOrderCreatedV1(fields: OrderCreatedFields): Buffer {
  return encodeProto("events.shopping.OrderCreatedV1", { ...fields });
}

export function encodeOrderPaidV1(fields: OrderPaidFields): Buffer {
  return encodeProto("events.shopping.OrderPaidV1", { ...fields });
}

export function encodeShipmentCreatedV1(fields: ShipmentCreatedFields): Buffer {
  return encodeProto("events.shopping.ShipmentCreatedV1", { ...fields });
}

function envelopeTimestampFromCreatedAt(createdAt: string | Date): string {
  if (createdAt instanceof Date) {
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("shopping_outbox_created_at_missing");
    }
    return createdAt.toISOString();
  }
  if (typeof createdAt === "string" && createdAt.length > 0) {
    return createdAt;
  }
  throw new Error("shopping_outbox_created_at_missing");
}

/**
 * Drain wrap: kafka_value = EventEnvelope protobuf.
 * event_id MUST be outbox.id — never mint a UUID here.
 * timestamp MUST be outbox.created_at — never mint wall-clock here.
 */
export function wrapShoppingOutboxRowAsEventEnvelope(
  row: ShoppingOutboxRowForWrap,
): Buffer {
  if (!row.id) {
    throw new Error("shopping_outbox_event_id_missing");
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
    source: SHOPPING_PRODUCER,
    entity_id: row.aggregate_id,
    timestamp,
    payload,
  });
  return Buffer.from(EventEnvelope.encode(msg).finish());
}

export function decodeShoppingEventEnvelope(buf: Buffer): {
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
