/**
 * Shared shopping write services: one covered domain mutation +
 * shopping.outbox_events INSERT on the same PoolClient transaction.
 *
 * event_id is minted once before BEGIN. Drain must not remint.
 * Listings-owned settlement events and purchase-history gRPC remain out of scope.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  CART_UPDATED_V1,
  ORDER_CREATED_V1,
  ORDER_PAID_V1,
  SHIPMENT_CREATED_V1,
  WATCHLIST_CHANGED_V1,
  encodeCartUpdatedV1,
  encodeOrderCreatedV1,
  encodeOrderPaidV1,
  encodeShipmentCreatedV1,
  encodeWatchlistChangedV1,
} from "../shoppingKafkaEvents.js";
import { insertShoppingOutboxEvent } from "../outbox/enqueueOutbox.js";
import { withShoppingTransaction } from "../lib/transaction.js";

export function mintShoppingEventId(): string {
  return randomUUID();
}

function iso(value: Date | string | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("shopping_outbox_timestamp_invalid");
    }
    return value.toISOString();
  }
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

function metadataJson(metadata: unknown): string | null {
  if (metadata == null) return null;
  if (typeof metadata === "string") return metadata;
  return JSON.stringify(metadata);
}

function totalCents(total: number | string): number {
  return Math.round(Number(total) * 100);
}

export type AddOrIncrementCartInput = {
  userId: string;
  itemType: string;
  itemId: string;
  quantity?: number;
  listingId?: string | null;
  price?: number | string | null;
  metadata?: unknown;
  notes?: string | null;
  eventId?: string;
  at?: string;
};

export type AddOrIncrementCartResult = {
  cartItemId: string;
  eventId: string;
};

export async function addOrIncrementCartWithOutbox(
  pool: Pool,
  input: AddOrIncrementCartInput,
): Promise<AddOrIncrementCartResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const at = iso(input.at);
  const quantity = input.quantity ?? 1;
  return withShoppingTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM shopping.shopping_cart
       WHERE user_id = $1 AND item_type = $2 AND item_id = $3
       FOR UPDATE`,
      [input.userId, input.itemType, input.itemId],
    );

    let row: { id: string; item_type: string; item_id: string };
    if (existing.rows[0]) {
      const notesUpdate = input.notes !== undefined;
      const updated = await client.query<{
        id: string;
        item_type: string;
        item_id: string;
      }>(
        notesUpdate
          ? `UPDATE shopping.shopping_cart
             SET quantity = $1, notes = $2, updated_at = now()
             WHERE id = $3
             RETURNING id, item_type, item_id`
          : `UPDATE shopping.shopping_cart
             SET quantity = $1, updated_at = now()
             WHERE id = $2
             RETURNING id, item_type, item_id`,
        notesUpdate
          ? [existing.rows[0].quantity + quantity, input.notes || null, existing.rows[0].id]
          : [existing.rows[0].quantity + quantity, existing.rows[0].id],
      );
      if (!updated.rows[0]) {
        throw new Error("shopping_cart_update_missing_after_write");
      }
      row = updated.rows[0];
    } else {
      const inserted = await client.query<{
        id: string;
        item_type: string;
        item_id: string;
      }>(
        `INSERT INTO shopping.shopping_cart
           (user_id, item_type, item_id, listing_id, quantity, price, metadata, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id, item_type, item_id`,
        [
          input.userId,
          input.itemType,
          input.itemId,
          input.listingId || null,
          quantity,
          input.price ?? null,
          metadataJson(input.metadata),
          input.notes || null,
        ],
      );
      if (!inserted.rows[0]) {
        throw new Error("shopping_cart_insert_missing_after_write");
      }
      row = inserted.rows[0];
    }

    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.userId,
      type: CART_UPDATED_V1,
      version: 1,
      payload: encodeCartUpdatedV1({
        user_id: input.userId,
        cart_item_id: row.id,
        item_type: row.item_type,
        item_id: row.item_id,
        updated_at: at,
      }),
    });
    return { cartItemId: row.id, eventId };
  });
}

export type UpdateCartItemInput = {
  userId: string;
  cartItemId: string;
  quantity?: number;
  price?: number | string;
  notes?: string | null;
  eventId?: string;
  at?: string;
};

export type UpdateCartItemResult =
  | { kind: "not_found"; eventId: null }
  | { kind: "updated"; eventId: string };

export async function updateCartItemWithOutbox(
  pool: Pool,
  input: UpdateCartItemInput,
): Promise<UpdateCartItemResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const at = iso(input.at);
  return withShoppingTransaction(pool, async (client) => {
    const updates: string[] = [];
    const values: unknown[] = [input.cartItemId, input.userId];
    let paramIndex = 3;
    if (input.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      values.push(input.quantity);
    }
    if (input.price !== undefined) {
      updates.push(`price = $${paramIndex++}`);
      values.push(input.price);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(input.notes || null);
    }
    if (updates.length === 0) {
      throw new Error("shopping_cart_update_no_fields");
    }
    updates.push("updated_at = now()");
    const result = await client.query<{
      id: string;
      item_type: string;
      item_id: string;
    }>(
      `UPDATE shopping.shopping_cart
       SET ${updates.join(", ")}
       WHERE id = $1 AND user_id = $2
       RETURNING id, item_type, item_id`,
      values,
    );
    if (!result.rows[0]) {
      return { kind: "not_found", eventId: null };
    }
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.userId,
      type: CART_UPDATED_V1,
      version: 1,
      payload: encodeCartUpdatedV1({
        user_id: input.userId,
        cart_item_id: result.rows[0].id,
        item_type: result.rows[0].item_type,
        item_id: result.rows[0].item_id,
        updated_at: at,
      }),
    });
    return { kind: "updated", eventId };
  });
}

export type DeleteCartItemInput = {
  userId: string;
  cartItemId: string;
  eventId?: string;
  at?: string;
};

export type DeleteCartItemResult =
  | { kind: "not_found"; eventId: null }
  | { kind: "deleted"; eventId: string };

export async function deleteCartItemWithOutbox(
  pool: Pool,
  input: DeleteCartItemInput,
): Promise<DeleteCartItemResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const at = iso(input.at);
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<{
      id: string;
      item_type: string;
      item_id: string;
    }>(
      `DELETE FROM shopping.shopping_cart
       WHERE id = $1 AND user_id = $2
       RETURNING id, item_type, item_id`,
      [input.cartItemId, input.userId],
    );
    if (!result.rows[0]) {
      return { kind: "not_found", eventId: null };
    }
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.userId,
      type: CART_UPDATED_V1,
      version: 1,
      payload: encodeCartUpdatedV1({
        user_id: input.userId,
        cart_item_id: result.rows[0].id,
        item_type: result.rows[0].item_type,
        item_id: result.rows[0].item_id,
        updated_at: at,
      }),
    });
    return { kind: "deleted", eventId };
  });
}

export type UpsertWatchlistInput = {
  userId: string;
  itemType: string;
  itemId: string;
  listingId?: string | null;
  notifyOn?: unknown;
  metadata?: unknown;
  eventId?: string;
  at?: string;
};

export type UpsertWatchlistResult = {
  watchlistId: string;
  eventId: string;
};

export async function upsertWatchlistWithOutbox(
  pool: Pool,
  input: UpsertWatchlistInput,
): Promise<UpsertWatchlistResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const at = iso(input.at);
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO shopping.watchlist (user_id, item_type, item_id, listing_id, notify_on, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (user_id, item_type, item_id)
       DO UPDATE SET notify_on = $5, metadata = $6::jsonb, updated_at = now()
       RETURNING id`,
      [
        input.userId,
        input.itemType,
        input.itemId,
        input.listingId || null,
        input.notifyOn ?? [],
        metadataJson(input.metadata),
      ],
    );
    if (!result.rows[0]) {
      throw new Error("shopping_watchlist_upsert_missing_after_write");
    }
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.userId,
      type: WATCHLIST_CHANGED_V1,
      version: 1,
      payload: encodeWatchlistChangedV1({
        user_id: input.userId,
        item_type: input.itemType,
        item_id: input.itemId,
        action: "added",
        changed_at: at,
      }),
    });
    return { watchlistId: result.rows[0].id, eventId };
  });
}

export type RemoveWatchlistInput = {
  userId: string;
  itemType: string;
  itemId: string;
  eventId?: string;
  at?: string;
};

export type RemoveWatchlistResult =
  | { kind: "not_found"; eventId: null }
  | { kind: "removed"; eventId: string };

export async function removeWatchlistWithOutbox(
  pool: Pool,
  input: RemoveWatchlistInput,
): Promise<RemoveWatchlistResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const at = iso(input.at);
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `DELETE FROM shopping.watchlist
       WHERE user_id = $1 AND item_type = $2 AND item_id = $3
       RETURNING id`,
      [input.userId, input.itemType, input.itemId],
    );
    if (!result.rows[0]) {
      return { kind: "not_found", eventId: null };
    }
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.userId,
      type: WATCHLIST_CHANGED_V1,
      version: 1,
      payload: encodeWatchlistChangedV1({
        user_id: input.userId,
        item_type: input.itemType,
        item_id: input.itemId,
        action: "removed",
        changed_at: at,
      }),
    });
    return { kind: "removed", eventId };
  });
}

export type CreateOrderInput = {
  userId: string;
  paymentMethod?: string;
  subtotal: number;
  shippingCost: number;
  tax: number;
  total: number;
  currency?: string;
  shippingAddress?: unknown;
  billingAddress?: unknown;
  notes?: string | null;
  metadata?: unknown;
  listingId?: string;
  sellerUserId?: string;
  eventId?: string;
  createdAt?: string;
};

export type CreateOrderResult = {
  order: {
    id: string;
    order_number: string;
    status: string;
    payment_status: string;
    total: string | number;
    created_at: Date | string;
  };
  eventId: string;
};

export async function createOrderWithOutbox(
  pool: Pool,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const createdAt = input.createdAt;
  const currency = input.currency ?? "USD";
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<CreateOrderResult["order"]>(
      `INSERT INTO shopping.orders (
         user_id, order_number, status, payment_status, payment_method,
         subtotal, shipping_cost, tax, total, currency,
         shipping_address, billing_address, notes, metadata
       )
       VALUES ($1, (SELECT shopping.generate_order_number()), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb)
       RETURNING id, order_number, status, payment_status, total, created_at`,
      [
        input.userId,
        "processing",
        "processing",
        input.paymentMethod ?? "simulated",
        input.subtotal,
        input.shippingCost,
        input.tax,
        input.total,
        currency,
        input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
        input.billingAddress ? JSON.stringify(input.billingAddress) : null,
        input.notes || null,
        metadataJson(input.metadata ?? { simulated_payment: true }),
      ],
    );
    if (!result.rows[0]) {
      throw new Error("shopping_order_insert_missing_after_write");
    }
    const order = result.rows[0];
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: order.id,
      type: ORDER_CREATED_V1,
      version: 1,
      payload: encodeOrderCreatedV1({
        order_id: order.id,
        buyer_user_id: input.userId,
        seller_user_id: input.sellerUserId ?? "",
        listing_id: input.listingId ?? "",
        total_cents: totalCents(input.total),
        currency,
        created_at: iso(createdAt ?? order.created_at),
      }),
    });
    return { order, eventId };
  });
}

export type MarkOrderPaidInput = {
  orderId: string;
  paymentTransactionId: string;
  eventId?: string;
  paidAt?: string;
};

export type MarkOrderPaidResult = {
  eventId: string;
};

export async function markOrderPaidWithOutbox(
  pool: Pool,
  input: MarkOrderPaidInput,
): Promise<MarkOrderPaidResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  const paidAt = iso(input.paidAt);
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE shopping.orders
       SET payment_status = 'paid',
           payment_transaction_id = $1,
           status = 'completed',
           completed_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [input.paymentTransactionId, input.orderId],
    );
    if (!result.rows[0]) {
      throw new Error("shopping_order_paid_missing_after_write");
    }
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: input.orderId,
      type: ORDER_PAID_V1,
      version: 1,
      payload: encodeOrderPaidV1({
        order_id: input.orderId,
        paid_at: paidAt,
        payment_ref: input.paymentTransactionId,
      }),
    });
    return { eventId };
  });
}

export type CreateShipmentInput = {
  orderId: string;
  eventId?: string;
  createdAt?: string;
};

export type CreateShipmentResult = {
  shipment: {
    id: string;
    tracking_number: string;
    carrier: string;
    status: string;
    created_at?: Date | string;
  };
  eventId: string;
};

export async function createShipmentWithOutbox(
  pool: Pool,
  input: CreateShipmentInput,
): Promise<CreateShipmentResult> {
  const eventId = input.eventId ?? mintShoppingEventId();
  return withShoppingTransaction(pool, async (client) => {
    const result = await client.query<CreateShipmentResult["shipment"]>(
      `INSERT INTO shopping.shipments (order_id, tracking_number, carrier, status)
       VALUES ($1, (SELECT shopping.generate_tracking_number()), 'SIMULATED', 'shipped')
       RETURNING id, tracking_number, carrier, status, created_at`,
      [input.orderId],
    );
    if (!result.rows[0]) {
      throw new Error("shopping_shipment_insert_missing_after_write");
    }
    const shipment = result.rows[0];
    await insertShoppingOutboxEvent(client, {
      eventId,
      aggregateId: shipment.id,
      type: SHIPMENT_CREATED_V1,
      version: 1,
      payload: encodeShipmentCreatedV1({
        shipment_id: shipment.id,
        order_id: input.orderId,
        carrier: shipment.carrier,
        created_at: iso(input.createdAt ?? shipment.created_at),
      }),
    });
    return { shipment, eventId };
  });
}
