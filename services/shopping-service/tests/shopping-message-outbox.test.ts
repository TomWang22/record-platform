/**
 * Phase B: transactional enqueue — protobuf Shopping*V1 BYTEA, event_id minted
 * once before PoolClient TX, HTTP+gRPC share helpers. SaleCompleted stays
 * listings-owned. AddPurchase / OrderPlacedV1 stay out of scope.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CART_UPDATED_V1,
  ORDER_CREATED_V1,
  ORDER_PAID_V1,
  SHIPMENT_CREATED_V1,
  WATCHLIST_CHANGED_V1,
  decodeShoppingEventEnvelope,
  encodeCartUpdatedV1,
  encodeOrderCreatedV1,
  encodeOrderPaidV1,
  encodeShipmentCreatedV1,
  encodeWatchlistChangedV1,
  wrapShoppingOutboxRowAsEventEnvelope,
} from "../src/shoppingKafkaEvents.js";
import { insertShoppingOutboxEvent } from "../src/outbox/enqueueOutbox.js";
import {
  addOrIncrementCartWithOutbox,
  createOrderWithOutbox,
  createShipmentWithOutbox,
  deleteCartItemWithOutbox,
  markOrderPaidWithOutbox,
  mintShoppingEventId,
  removeWatchlistWithOutbox,
  updateCartItemWithOutbox,
  upsertWatchlistWithOutbox,
} from "../src/application/shoppingOutbox.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CART_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "55555555-5555-4555-8555-555555555555";
const SHIPMENT_ID = "66666666-6666-4666-8666-666666666666";
const LISTING_ID = "77777777-7777-4777-8777-777777777777";
const AT = "2026-08-10T12:00:00.000Z";

type QueryCall = { sql: string; params: unknown[] };

function makeFakePool(opts?: {
  failOn?: "domain" | "outbox" | "commit";
  existingCart?: { id: string; quantity: number } | null;
  cartRow?: Record<string, unknown>;
  watchlistRow?: Record<string, unknown>;
  orderRow?: Record<string, unknown>;
  shipmentRow?: Record<string, unknown>;
  deleteCartRow?: Record<string, unknown> | null;
  deleteWatchlistRow?: Record<string, unknown> | null;
}) {
  const calls: QueryCall[] = [];
  let inTx = false;
  let committed = false;
  let rolledBack = false;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      const norm = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: norm, params });
      if (norm === "BEGIN") {
        inTx = true;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "COMMIT") {
        if (opts?.failOn === "commit") throw new Error("commit_boom");
        committed = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "ROLLBACK") {
        rolledBack = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO shopping.outbox_events")) {
        if (opts?.failOn === "outbox") throw new Error("outbox_boom");
        return { rows: [], rowCount: 1 };
      }
      if (opts?.failOn === "domain" && !norm.includes("shopping.outbox_events")) {
        throw new Error("domain_boom");
      }
      if (norm.startsWith("SELECT") && norm.includes("FROM shopping.shopping_cart")) {
        const existing = opts?.existingCart;
        return existing
          ? { rows: [existing], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO shopping.shopping_cart")) {
        return {
          rows: [
            opts?.cartRow ?? {
              id: CART_ITEM_ID,
              item_type: "listing",
              item_id: ITEM_ID,
            },
          ],
          rowCount: 1,
        };
      }
      if (norm.includes("UPDATE shopping.shopping_cart")) {
        return {
          rows: [
            opts?.cartRow ?? {
              id: CART_ITEM_ID,
              item_type: "listing",
              item_id: ITEM_ID,
            },
          ],
          rowCount: 1,
        };
      }
      if (norm.includes("DELETE FROM shopping.shopping_cart")) {
        const row = opts?.deleteCartRow === undefined
          ? { id: CART_ITEM_ID, item_type: "listing", item_id: ITEM_ID }
          : opts.deleteCartRow;
        return row
          ? { rows: [row], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO shopping.watchlist")) {
        return {
          rows: [opts?.watchlistRow ?? { id: "wl-1" }],
          rowCount: 1,
        };
      }
      if (norm.includes("DELETE FROM shopping.watchlist")) {
        const row = opts?.deleteWatchlistRow === undefined
          ? { id: "wl-1" }
          : opts.deleteWatchlistRow;
        return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO shopping.orders")) {
        return {
          rows: [
            opts?.orderRow ?? {
              id: ORDER_ID,
              order_number: "ORD-2026-000001",
              status: "processing",
              payment_status: "processing",
              total: "42.00",
              created_at: new Date(AT),
            },
          ],
          rowCount: 1,
        };
      }
      if (norm.includes("UPDATE shopping.orders")) {
        return { rows: [{ id: ORDER_ID }], rowCount: 1 };
      }
      if (norm.includes("INSERT INTO shopping.shipments")) {
        return {
          rows: [
            opts?.shipmentRow ?? {
              id: SHIPMENT_ID,
              tracking_number: "TRK-ABC",
              carrier: "SIMULATED",
              status: "shipped",
              created_at: new Date(AT),
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected_sql:${norm.slice(0, 120)}`);
    },
    release: vi.fn(),
  };

  const pool = {
    connect: async () => client,
    query: async () => {
      throw new Error("bare_pool_query_forbidden_in_phase_b_helper");
    },
  };

  return {
    pool: pool as never,
    calls,
    getState: () => ({ inTx, committed, rolledBack }),
  };
}

function outboxInsert(calls: QueryCall[]) {
  return calls.find((c) => c.sql.includes("INSERT INTO shopping.outbox_events"));
}

describe("insertShoppingOutboxEvent", () => {
  it("rejects missing event_id before any SQL", async () => {
    const client = { query: vi.fn() };
    await expect(
      insertShoppingOutboxEvent(client as never, {
        eventId: "",
        aggregateId: USER_ID,
        type: CART_UPDATED_V1,
        version: 1,
        payload: encodeCartUpdatedV1({
          user_id: USER_ID,
          cart_item_id: CART_ITEM_ID,
          item_type: "listing",
          item_id: ITEM_ID,
          updated_at: AT,
        }),
      }),
    ).rejects.toThrow(/shopping_outbox_event_id_missing/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("E13 rejects OrderPlacedV1 and SaleCompleted", async () => {
    const client = { query: vi.fn() };
    await expect(
      insertShoppingOutboxEvent(client as never, {
        eventId: EVENT_ID,
        aggregateId: ORDER_ID,
        type: "OrderPlacedV1",
        version: 1,
        payload: Buffer.from("x"),
      }),
    ).rejects.toThrow(/shopping_outbox_type_invalid:OrderPlacedV1/);
    await expect(
      insertShoppingOutboxEvent(client as never, {
        eventId: EVENT_ID,
        aggregateId: ORDER_ID,
        type: "SaleCompleted",
        version: 1,
        payload: Buffer.from("x"),
      }),
    ).rejects.toThrow(/shopping_outbox_type_invalid:SaleCompleted/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("E1/E5/E6/E7 cart CartUpdatedV1", () => {
  it("same PoolClient TX, proto BYTEA, event_id === outbox.id, aggregate=user_id", async () => {
    const { pool, calls, getState } = makeFakePool();
    const result = await addOrIncrementCartWithOutbox(pool, {
      userId: USER_ID,
      itemType: "listing",
      itemId: ITEM_ID,
      listingId: LISTING_ID,
      quantity: 1,
      price: 10,
      eventId: EVENT_ID,
      at: AT,
    });

    expect(getState().committed).toBe(true);
    expect(getState().rolledBack).toBe(false);
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.cartItemId).toBe(CART_ITEM_ID);
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");

    const insert = outboxInsert(calls);
    expect(insert).toBeTruthy();
    expect(insert!.params[0]).toBe(EVENT_ID);
    expect(insert!.params[1]).toBe(USER_ID);
    expect(insert!.params[2]).toBe(CART_UPDATED_V1);
    expect(insert!.params[3]).toBe(1);
    const payload = insert!.params[4] as Buffer;
    const expected = encodeCartUpdatedV1({
      user_id: USER_ID,
      cart_item_id: CART_ITEM_ID,
      item_type: "listing",
      item_id: ITEM_ID,
      updated_at: AT,
    });
    expect(payload.equals(expected)).toBe(true);

    const wrapped = wrapShoppingOutboxRowAsEventEnvelope({
      id: EVENT_ID,
      aggregate_id: USER_ID,
      type: CART_UPDATED_V1,
      version: 1,
      payload,
      created_at: AT,
    });
    const env = decodeShoppingEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.timestamp).toBe(AT);
    expect(env.payload.equals(payload)).toBe(true);
  });

  it("E2 domain failure ⇒ zero outbox", async () => {
    const { pool, calls, getState } = makeFakePool({ failOn: "domain" });
    await expect(
      addOrIncrementCartWithOutbox(pool, {
        userId: USER_ID,
        itemType: "listing",
        itemId: ITEM_ID,
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toThrow(/domain_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(outboxInsert(calls)).toBeUndefined();
  });

  it("E3 outbox failure rolls domain", async () => {
    const { pool, getState } = makeFakePool({ failOn: "outbox" });
    await expect(
      addOrIncrementCartWithOutbox(pool, {
        userId: USER_ID,
        itemType: "listing",
        itemId: ITEM_ID,
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toThrow(/outbox_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });

  it("E4 commit failure fail-closed", async () => {
    const { pool, getState } = makeFakePool({ failOn: "commit" });
    await expect(
      addOrIncrementCartWithOutbox(pool, {
        userId: USER_ID,
        itemType: "listing",
        itemId: ITEM_ID,
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toThrow(/commit_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(getState().committed).toBe(false);
  });
});

describe("E7/E13 watchlist / order / payment / shipment aggregates", () => {
  it("WatchlistChangedV1 aggregate=user_id action=added|removed", async () => {
    const added = makeFakePool();
    const addResult = await upsertWatchlistWithOutbox(added.pool, {
      userId: USER_ID,
      itemType: "listing",
      itemId: ITEM_ID,
      eventId: EVENT_ID,
      at: AT,
    });
    expect(addResult.eventId).toBe(EVENT_ID);
    const addInsert = outboxInsert(added.calls)!;
    expect(addInsert.params[1]).toBe(USER_ID);
    expect(addInsert.params[2]).toBe(WATCHLIST_CHANGED_V1);
    expect(
      (addInsert.params[4] as Buffer).equals(
        encodeWatchlistChangedV1({
          user_id: USER_ID,
          item_type: "listing",
          item_id: ITEM_ID,
          action: "added",
          changed_at: AT,
        }),
      ),
    ).toBe(true);

    const removed = makeFakePool();
    const remResult = await removeWatchlistWithOutbox(removed.pool, {
      userId: USER_ID,
      itemType: "listing",
      itemId: ITEM_ID,
      eventId: EVENT_ID,
      at: AT,
    });
    expect(remResult.kind).toBe("removed");
    const remInsert = outboxInsert(removed.calls)!;
    expect(remInsert.params[1]).toBe(USER_ID);
    expect(
      (remInsert.params[4] as Buffer).equals(
        encodeWatchlistChangedV1({
          user_id: USER_ID,
          item_type: "listing",
          item_id: ITEM_ID,
          action: "removed",
          changed_at: AT,
        }),
      ),
    ).toBe(true);
  });

  it("OrderCreatedV1 aggregate=order_id", async () => {
    const { pool, calls } = makeFakePool();
    const result = await createOrderWithOutbox(pool, {
      userId: USER_ID,
      paymentMethod: "simulated",
      subtotal: 32,
      shippingCost: 10,
      tax: 0,
      total: 42,
      currency: "USD",
      listingId: LISTING_ID,
      sellerUserId: "",
      eventId: EVENT_ID,
      createdAt: AT,
    });
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.order.id).toBe(ORDER_ID);
    const insert = outboxInsert(calls)!;
    expect(insert.params[1]).toBe(ORDER_ID);
    expect(insert.params[2]).toBe(ORDER_CREATED_V1);
    expect(
      (insert.params[4] as Buffer).equals(
        encodeOrderCreatedV1({
          order_id: ORDER_ID,
          buyer_user_id: USER_ID,
          seller_user_id: "",
          listing_id: LISTING_ID,
          total_cents: 4200,
          currency: "USD",
          created_at: AT,
        }),
      ),
    ).toBe(true);
  });

  it("OrderPaidV1 aggregate=order_id", async () => {
    const { pool, calls } = makeFakePool();
    const result = await markOrderPaidWithOutbox(pool, {
      orderId: ORDER_ID,
      paymentTransactionId: "PAY-1",
      eventId: EVENT_ID,
      paidAt: AT,
    });
    expect(result.eventId).toBe(EVENT_ID);
    const insert = outboxInsert(calls)!;
    expect(insert.params[1]).toBe(ORDER_ID);
    expect(insert.params[2]).toBe(ORDER_PAID_V1);
    expect(
      (insert.params[4] as Buffer).equals(
        encodeOrderPaidV1({
          order_id: ORDER_ID,
          paid_at: AT,
          payment_ref: "PAY-1",
        }),
      ),
    ).toBe(true);
  });

  it("ShipmentCreatedV1 aggregate=shipment_id", async () => {
    const { pool, calls } = makeFakePool();
    const result = await createShipmentWithOutbox(pool, {
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      createdAt: AT,
    });
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.shipment.id).toBe(SHIPMENT_ID);
    const insert = outboxInsert(calls)!;
    expect(insert.params[1]).toBe(SHIPMENT_ID);
    expect(insert.params[2]).toBe(SHIPMENT_CREATED_V1);
    expect(
      (insert.params[4] as Buffer).equals(
        encodeShipmentCreatedV1({
          shipment_id: SHIPMENT_ID,
          order_id: ORDER_ID,
          carrier: "SIMULATED",
          created_at: AT,
        }),
      ),
    ).toBe(true);
  });

  it("HTTP cart update/delete also emit CartUpdatedV1 with user_id aggregate", async () => {
    const updated = makeFakePool();
    await updateCartItemWithOutbox(updated.pool, {
      userId: USER_ID,
      cartItemId: CART_ITEM_ID,
      quantity: 2,
      eventId: EVENT_ID,
      at: AT,
    });
    expect(outboxInsert(updated.calls)!.params[1]).toBe(USER_ID);
    expect(outboxInsert(updated.calls)!.params[2]).toBe(CART_UPDATED_V1);

    const deleted = makeFakePool();
    await deleteCartItemWithOutbox(deleted.pool, {
      userId: USER_ID,
      cartItemId: CART_ITEM_ID,
      eventId: EVENT_ID,
      at: AT,
    });
    expect(outboxInsert(deleted.calls)!.params[1]).toBe(USER_ID);
    expect(outboxInsert(deleted.calls)!.params[2]).toBe(CART_UPDATED_V1);
  });
});

describe("identity minting", () => {
  it("mintShoppingEventId is UUID v4; drain source still must not mint", () => {
    expect(mintShoppingEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const drainSrc = readFileSync(join(SRC, "outbox/publishOutbox.ts"), "utf8");
    expect(drainSrc).not.toMatch(/from ["']node:crypto["']/);
    expect(drainSrc).not.toMatch(/crypto\.randomUUID/);
    expect(drainSrc).not.toMatch(/mintShoppingEventId/);
    expect(drainSrc).not.toMatch(/new Date\s*\(\s*\)/);
  });
});

describe("E8–E15 coverage wiring", () => {
  it("E8 HTTP cart paths use shared helpers", () => {
    const httpTs = readFileSync(join(SRC, "routes/cart.ts"), "utf8");
    expect(httpTs).toMatch(/addOrIncrementCartWithOutbox/);
    expect(httpTs).toMatch(/updateCartItemWithOutbox/);
    expect(httpTs).toMatch(/deleteCartItemWithOutbox/);
  });

  it("E9 covered checkout shopping transitions use shared helper", () => {
    const httpTs = readFileSync(join(SRC, "routes/cart.ts"), "utf8");
    expect(httpTs).toMatch(/createOrderWithOutbox/);
    expect(httpTs).toMatch(/markOrderPaidWithOutbox/);
    expect(httpTs).toMatch(/createShipmentWithOutbox/);
  });

  it("E10 covered watchlist paths use shared helper", () => {
    const httpTs = readFileSync(join(SRC, "routes/watchlist.ts"), "utf8");
    const grpcTs = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(httpTs).toMatch(/upsertWatchlistWithOutbox/);
    expect(httpTs).toMatch(/removeWatchlistWithOutbox/);
    expect(grpcTs).toMatch(/upsertWatchlistWithOutbox/);
    expect(grpcTs).toMatch(/removeWatchlistWithOutbox/);
  });

  it("E11 gRPC AddToCart uses same transactional path", () => {
    const grpcTs = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(grpcTs).toMatch(/addOrIncrementCartWithOutbox/);
  });

  it("E12 no direct Kafka substitute for covered semantic events", () => {
    const cartTs = readFileSync(join(SRC, "routes/cart.ts"), "utf8");
    const watchTs = readFileSync(join(SRC, "routes/watchlist.ts"), "utf8");
    const appTs = readFileSync(join(SRC, "application/shoppingOutbox.ts"), "utf8");
    const enqTs = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const grpcTs = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(cartTs).not.toMatch(/producer\.send/);
    expect(watchTs).not.toMatch(/producer\.send/);
    expect(appTs).not.toMatch(/producer\.send/);
    expect(enqTs).not.toMatch(/producer\.send/);
    expect(grpcTs).not.toMatch(/topic:\s*['"]shopping-cart['"]/);
    expect(grpcTs).toMatch(/topic:\s*['"]purchases['"]/);
  });

  it("E13 enqueue allows only frozen shopping types", () => {
    const enqTs = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    expect(enqTs).toMatch(/CART_UPDATED_V1/);
    expect(enqTs).toMatch(/WATCHLIST_CHANGED_V1/);
    expect(enqTs).toMatch(/ORDER_CREATED_V1/);
    expect(enqTs).toMatch(/ORDER_PAID_V1/);
    expect(enqTs).toMatch(/SHIPMENT_CREATED_V1/);
    expect(enqTs).not.toMatch(/ORDER_PLACED/);
    expect(enqTs).not.toMatch(/SaleCompleted/);
  });

  it("E14 kafka_value wraps stored proto; drain does not remint id or timestamp", () => {
    const payload = encodeCartUpdatedV1({
      user_id: USER_ID,
      cart_item_id: CART_ITEM_ID,
      item_type: "listing",
      item_id: ITEM_ID,
      updated_at: AT,
    });
    const wrapped = wrapShoppingOutboxRowAsEventEnvelope({
      id: EVENT_ID,
      aggregate_id: USER_ID,
      type: CART_UPDATED_V1,
      version: 1,
      payload,
      created_at: AT,
    });
    expect(wrapped.equals(payload)).toBe(false);
    const env = decodeShoppingEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.timestamp).toBe(AT);
    expect(env.payload.equals(payload)).toBe(true);
  });

  it("E15 SaleCompleted emitter/drain remains listings-only", () => {
    const emitter = readFileSync(join(SRC, "lib/sale-completed-emitter.ts"), "utf8");
    const drain = readFileSync(join(SRC, "lib/sale-completed-outbox-drain.ts"), "utf8");
    const enq = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const app = readFileSync(join(SRC, "application/shoppingOutbox.ts"), "utf8");
    expect(emitter).toMatch(/INSERT INTO listings\.outbox_events/);
    expect(drain).toMatch(/listings\.outbox_events/);
    expect(enq).not.toMatch(/listings\.outbox_events/);
    expect(app).not.toMatch(/listings\.outbox_events/);
    expect(app).not.toMatch(/INSERT INTO listings/);
    expect(enq).not.toMatch(/SaleCompleted/);
  });

  it("enqueue uses PoolClient, not a second pool", () => {
    const enqTs = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const appTs = readFileSync(join(SRC, "application/shoppingOutbox.ts"), "utf8");
    const txTs = readFileSync(join(SRC, "lib/transaction.ts"), "utf8");
    expect(enqTs).toMatch(/PoolClient/);
    expect(enqTs).not.toMatch(/new Pool/);
    expect(appTs).toMatch(/withShoppingTransaction/);
    expect(txTs).toMatch(/pool\.connect/);
    expect(txTs).not.toMatch(/new Pool/);
  });
});
