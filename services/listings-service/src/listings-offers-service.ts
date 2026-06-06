/**
 * OBO offer lifecycle — DB transactions, audit events, outbox/Kafka emission.
 */
import type { PoolClient } from "pg";
import { pool } from "./lib/db.js";
import { parseRpListingFields } from "./rp-listing-fields.js";
import {
  buildPublicOffer,
  type OfferEventRow,
  type OfferRow,
} from "./listings-offers-contract.js";
import {
  insertOfferOutboxRow,
  markOfferOutboxPublished,
  newOfferEventId,
  publishOfferOutboxAndKafka,
  type OfferKafkaEventType,
} from "./listings-offers-outbox.js";

export type OfferSettings = {
  listing_id: string;
  obo_enabled: boolean;
  max_offer_attempts: number;
  min_auto_accept_cents: number | null;
  min_auto_reject_cents: number | null;
  offer_expiration_hours: number;
  allow_counteroffers: boolean;
};

type ListingContext = {
  id: string;
  user_id: string;
  title: string | null;
  price_cents: number;
  status: string;
  pricing_mode: string;
  amenities: unknown;
  username_display: string | null;
  deleted_at: Date | null;
};

export class OfferServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function amenityBool(map: Record<string, string>, key: string): boolean {
  const v = map[key];
  return v === "true" || v === "1";
}

function amenityInt(map: Record<string, string>, key: string, fallback: number): number {
  const v = Number(map[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export async function loadOfferSettings(
  client: PoolClient,
  listing: ListingContext,
): Promise<OfferSettings> {
  const cur = await client.query(
    `SELECT * FROM listings.offer_settings WHERE listing_id = $1::uuid`,
    [listing.id],
  );
  if (cur.rows[0]) {
    return cur.rows[0] as OfferSettings;
  }
  const rp = parseRpListingFields(listing as Record<string, unknown>);
  const pm = String(listing.pricing_mode || "fixed").toLowerCase();
  const obo =
    rp.saleType === "obo" ||
    pm === "obo" ||
    rp.allowOffers === true;
  return {
    listing_id: listing.id,
    obo_enabled: obo,
    max_offer_attempts: amenityInt(
      { max_offer_attempts: rp.maxOfferAttempts ?? "" },
      "max_offer_attempts",
      3,
    ),
    min_auto_accept_cents: rp.autoAcceptCents ? Number(rp.autoAcceptCents) : null,
    min_auto_reject_cents: rp.autoDeclineCents ? Number(rp.autoDeclineCents) : null,
    offer_expiration_hours: amenityInt(
      { offer_expiration_hours: rp.offerExpirationHours ?? "" },
      "offer_expiration_hours",
      48,
    ),
    allow_counteroffers: true,
  };
}

async function loadListing(client: PoolClient, listingId: string): Promise<ListingContext> {
  const r = await client.query(
    `SELECT id, user_id, title, price_cents, status::text AS status, pricing_mode, amenities,
            username_display, deleted_at
     FROM listings.listings WHERE id = $1::uuid`,
    [listingId],
  );
  const row = r.rows[0] as ListingContext | undefined;
  if (!row || row.deleted_at) throw new OfferServiceError("listing not found", 404);
  return row;
}

async function insertOfferEvent(
  client: PoolClient,
  input: {
    offerId: string;
    listingId: string;
    actorUserId: string;
    eventType: string;
    previousStatus: string | null;
    newStatus: string;
    amountCents?: number | null;
    message?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO listings.offer_events
       (offer_id, listing_id, actor_user_id, event_type, previous_status, new_status, amount_cents, message, metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      input.offerId,
      input.listingId,
      input.actorUserId,
      input.eventType,
      input.previousStatus,
      input.newStatus,
      input.amountCents ?? null,
      input.message ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function queueOfferOutbox(
  client: PoolClient,
  input: {
    eventType: OfferKafkaEventType;
    offerId: string;
    listingId: string;
    buyerUserId: string;
    sellerUserId: string;
    amountCents: number;
    status: string;
    listingTitle?: string | null;
  },
): Promise<{ eventId: string; payload: Record<string, unknown> }> {
  const eventId = newOfferEventId();
  const payload = {
    offer_id: input.offerId,
    listing_id: input.listingId,
    buyer_user_id: input.buyerUserId,
    seller_user_id: input.sellerUserId,
    amount_cents: input.amountCents,
    status: input.status,
    listing_title: input.listingTitle ?? null,
  };
  await insertOfferOutboxRow(client, {
    eventId,
    aggregateId: input.offerId,
    eventType: input.eventType,
    payload,
  });
  return { eventId, payload };
}

async function flushOfferOutboxEvent(input: {
  eventId: string;
  offerId: string;
  listingId: string;
  eventType: OfferKafkaEventType;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await publishOfferOutboxAndKafka(input);
    const c2 = await pool.connect();
    try {
      await markOfferOutboxPublished(c2, input.eventId);
    } finally {
      c2.release();
    }
  } catch (e) {
    console.error("[listings-offers] kafka publish failed; outbox row retained", e);
  }
}

async function countBuyerAttempts(
  client: PoolClient,
  listingId: string,
  buyerUserId: string,
): Promise<number> {
  const r = await client.query(
    `SELECT COUNT(*)::int AS attempt_count
     FROM listings.offers
     WHERE listing_id = $1::uuid AND buyer_user_id = $2::uuid AND parent_offer_id IS NULL`,
    [listingId, buyerUserId],
  );
  return Number(r.rows[0]?.attempt_count ?? 0);
}

async function fetchOfferEvents(client: PoolClient, offerId: string): Promise<OfferEventRow[]> {
  const r = await client.query(
    `SELECT * FROM listings.offer_events WHERE offer_id = $1::uuid ORDER BY created_at ASC`,
    [offerId],
  );
  return r.rows as OfferEventRow[];
}

async function fetchOfferRow(client: PoolClient, offerId: string): Promise<OfferRow | null> {
  const r = await client.query(
    `SELECT o.*, l.title AS listing_title, l.username_display AS seller_display
     FROM listings.offers o
     JOIN listings.listings l ON l.id = o.listing_id
     WHERE o.id = $1::uuid`,
    [offerId],
  );
  return (r.rows[0] as OfferRow | undefined) ?? null;
}

function computeExpiresAt(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

async function rejectCompetingPending(
  client: PoolClient,
  listingId: string,
  acceptedOfferId: string,
  actorUserId: string,
): Promise<void> {
  const pending = await client.query(
    `SELECT id, status FROM listings.offers
     WHERE listing_id = $1::uuid AND status = 'pending' AND id <> $2::uuid`,
    [listingId, acceptedOfferId],
  );
  for (const row of pending.rows as { id: string; status: string }[]) {
    await client.query(
      `UPDATE listings.offers SET status = 'rejected', decided_at = now(), updated_at = now()
       WHERE id = $1::uuid`,
      [row.id],
    );
    await insertOfferEvent(client, {
      offerId: row.id,
      listingId,
      actorUserId,
      eventType: "rejected",
      previousStatus: row.status,
      newStatus: "rejected",
      metadata: { reason: "competing_offer_accepted", accepted_offer_id: acceptedOfferId },
    });
  }
}

export async function createOffer(input: {
  listingId: string;
  buyerUserId: string;
  amountCents: number;
  message?: string;
}): Promise<Record<string, unknown>> {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new OfferServiceError("invalid amount", 400);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const listing = await loadListing(client, input.listingId);
    if (String(listing.user_id) === input.buyerUserId) {
      throw new OfferServiceError("buyer cannot offer on own listing", 403);
    }
    if (String(listing.status).toLowerCase() !== "active") {
      throw new OfferServiceError("listing not active", 400);
    }
    const settings = await loadOfferSettings(client, listing);
    if (!settings.obo_enabled) {
      throw new OfferServiceError("listing does not accept offers", 400);
    }
    const attempts = await countBuyerAttempts(client, input.listingId, input.buyerUserId);
    if (attempts >= settings.max_offer_attempts) {
      throw new OfferServiceError("max offer attempts exceeded", 400);
    }
    const attemptNumber = attempts + 1;
    const expiresAt = computeExpiresAt(settings.offer_expiration_hours);
    let status = "pending";
    let decidedAt: Date | null = null;
    if (
      settings.min_auto_accept_cents != null &&
      input.amountCents >= settings.min_auto_accept_cents
    ) {
      status = "accepted";
      decidedAt = new Date();
    } else if (
      settings.min_auto_reject_cents != null &&
      input.amountCents < settings.min_auto_reject_cents
    ) {
      status = "rejected";
      decidedAt = new Date();
    }
    const ins = await client.query(
      `INSERT INTO listings.offers
         (listing_id, buyer_user_id, seller_user_id, amount_cents, currency, status, message, expires_at, attempt_number, decided_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'USD', $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.listingId,
        input.buyerUserId,
        listing.user_id,
        input.amountCents,
        status,
        input.message ?? null,
        expiresAt,
        attemptNumber,
        decidedAt,
      ],
    );
    const offer = ins.rows[0] as OfferRow;
    await insertOfferEvent(client, {
      offerId: offer.id,
      listingId: input.listingId,
      actorUserId: input.buyerUserId,
      eventType: "created",
      previousStatus: null,
      newStatus: status,
      amountCents: input.amountCents,
      message: input.message ?? null,
    });
    if (status === "accepted") {
      await rejectCompetingPending(client, input.listingId, offer.id, listing.user_id);
      await insertOfferEvent(client, {
        offerId: offer.id,
        listingId: input.listingId,
        actorUserId: listing.user_id,
        eventType: "accepted",
        previousStatus: "pending",
        newStatus: "accepted",
        amountCents: input.amountCents,
        metadata: { auto_accept: true },
      });
    } else if (status === "rejected") {
      await insertOfferEvent(client, {
        offerId: offer.id,
        listingId: input.listingId,
        actorUserId: listing.user_id,
        eventType: "rejected",
        previousStatus: "pending",
        newStatus: "rejected",
        amountCents: input.amountCents,
        metadata: { auto_reject: true },
      });
    }
    const kafkaType: OfferKafkaEventType =
      status === "accepted"
        ? "OfferAccepted"
        : status === "rejected"
          ? "OfferRejected"
          : "OfferCreated";
    const queued = await queueOfferOutbox(client, {
      eventType: kafkaType,
      offerId: offer.id,
      listingId: input.listingId,
      buyerUserId: input.buyerUserId,
      sellerUserId: String(listing.user_id),
      amountCents: input.amountCents,
      status,
      listingTitle: listing.title,
    });
    const events = await fetchOfferEvents(client, offer.id);
    const publicOffer = await buildPublicOffer(
      { ...offer, listing_title: listing.title, seller_display: listing.username_display },
      events,
    );
    await client.query("COMMIT");
    await flushOfferOutboxEvent({
      eventId: queued.eventId,
      offerId: offer.id,
      listingId: input.listingId,
      eventType: kafkaType,
      payload: queued.payload,
    });
    return publicOffer;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function transitionOffer(
  offerId: string,
  actorUserId: string,
  role: "buyer" | "seller",
  input: {
    newStatus: "accepted" | "rejected" | "withdrawn";
    eventType: OfferKafkaEventType;
    extraEventType?: string;
  },
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await fetchOfferRow(client, offerId);
    if (!row) throw new OfferServiceError("offer not found", 404);
    if (role === "seller" && row.seller_user_id !== actorUserId) {
      throw new OfferServiceError("forbidden", 403);
    }
    if (role === "buyer" && row.buyer_user_id !== actorUserId) {
      throw new OfferServiceError("forbidden", 403);
    }
    const terminal = new Set(["accepted", "rejected", "expired", "withdrawn"]);
    if (terminal.has(String(row.status))) {
      throw new OfferServiceError(`offer is ${row.status}`, 400);
    }
    const prev = String(row.status);
    await client.query(
      `UPDATE listings.offers SET status = $1, decided_at = now(), updated_at = now() WHERE id = $2::uuid`,
      [input.newStatus, offerId],
    );
    await insertOfferEvent(client, {
      offerId,
      listingId: row.listing_id,
      actorUserId,
      eventType: input.extraEventType ?? input.newStatus,
      previousStatus: prev,
      newStatus: input.newStatus,
      amountCents: row.amount_cents,
    });
    if (input.newStatus === "accepted") {
      await rejectCompetingPending(client, row.listing_id, offerId, row.seller_user_id);
    }
    const queued = await queueOfferOutbox(client, {
      eventType: input.eventType,
      offerId,
      listingId: row.listing_id,
      buyerUserId: row.buyer_user_id,
      sellerUserId: row.seller_user_id,
      amountCents: row.amount_cents,
      status: input.newStatus,
      listingTitle: row.listing_title,
    });
    const updatedRow = (await fetchOfferRow(client, offerId)) ?? row;
    const events = await fetchOfferEvents(client, offerId);
    const publicOffer = await buildPublicOffer(updatedRow, events);
    await client.query("COMMIT");
    await flushOfferOutboxEvent({
      eventId: queued.eventId,
      offerId,
      listingId: row.listing_id,
      eventType: input.eventType,
      payload: queued.payload,
    });
    return publicOffer;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function acceptOffer(offerId: string, sellerUserId: string) {
  return transitionOffer(offerId, sellerUserId, "seller", {
    newStatus: "accepted",
    eventType: "OfferAccepted",
  });
}

export async function rejectOffer(offerId: string, sellerUserId: string) {
  return transitionOffer(offerId, sellerUserId, "seller", {
    newStatus: "rejected",
    eventType: "OfferRejected",
  });
}

export async function withdrawOffer(offerId: string, buyerUserId: string) {
  return transitionOffer(offerId, buyerUserId, "buyer", {
    newStatus: "withdrawn",
    eventType: "OfferWithdrawn",
  });
}

export async function counterOffer(input: {
  offerId: string;
  sellerUserId: string;
  amountCents: number;
  message?: string;
}): Promise<Record<string, unknown>> {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new OfferServiceError("invalid amount", 400);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const parent = await fetchOfferRow(client, input.offerId);
    if (!parent) throw new OfferServiceError("offer not found", 404);
    if (parent.seller_user_id !== input.sellerUserId) {
      throw new OfferServiceError("forbidden", 403);
    }
    if (!["pending", "countered"].includes(String(parent.status))) {
      throw new OfferServiceError(`cannot counter offer in status ${parent.status}`, 400);
    }
    const listing = await loadListing(client, parent.listing_id);
    const settings = await loadOfferSettings(client, listing);
    if (!settings.allow_counteroffers) {
      throw new OfferServiceError("counteroffers not allowed", 400);
    }
    const prev = String(parent.status);
    await client.query(
      `UPDATE listings.offers SET status = 'countered', updated_at = now() WHERE id = $1::uuid`,
      [input.offerId],
    );
    await insertOfferEvent(client, {
      offerId: input.offerId,
      listingId: parent.listing_id,
      actorUserId: input.sellerUserId,
      eventType: "countered",
      previousStatus: prev,
      newStatus: "countered",
      amountCents: input.amountCents,
      message: input.message ?? null,
    });
    const expiresAt = computeExpiresAt(settings.offer_expiration_hours);
    const child = await client.query(
      `INSERT INTO listings.offers
         (listing_id, buyer_user_id, seller_user_id, amount_cents, currency, status, message, expires_at,
          parent_offer_id, attempt_number)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'USD', 'pending', $5, $6, $7::uuid, $8)
       RETURNING *`,
      [
        parent.listing_id,
        parent.buyer_user_id,
        parent.seller_user_id,
        input.amountCents,
        input.message ?? null,
        expiresAt,
        input.offerId,
        parent.attempt_number,
      ],
    );
    const offer = child.rows[0] as OfferRow;
    await insertOfferEvent(client, {
      offerId: offer.id,
      listingId: parent.listing_id,
      actorUserId: input.sellerUserId,
      eventType: "created",
      previousStatus: null,
      newStatus: "pending",
      amountCents: input.amountCents,
      message: input.message ?? null,
      metadata: { counter_to: input.offerId },
    });
    const queued = await queueOfferOutbox(client, {
      eventType: "OfferCountered",
      offerId: offer.id,
      listingId: parent.listing_id,
      buyerUserId: parent.buyer_user_id,
      sellerUserId: parent.seller_user_id,
      amountCents: input.amountCents,
      status: "pending",
      listingTitle: listing.title,
    });
    const events = await fetchOfferEvents(client, offer.id);
    const publicOffer = await buildPublicOffer(
      { ...offer, listing_title: listing.title, seller_display: listing.username_display },
      events,
    );
    await client.query("COMMIT");
    await flushOfferOutboxEvent({
      eventId: queued.eventId,
      offerId: offer.id,
      listingId: parent.listing_id,
      eventType: "OfferCountered",
      payload: queued.payload,
    });
    return publicOffer;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function getOfferById(offerId: string, viewerUserId: string) {
  const client = await pool.connect();
  try {
    const row = await fetchOfferRow(client, offerId);
    if (!row) throw new OfferServiceError("offer not found", 404);
    if (row.buyer_user_id !== viewerUserId && row.seller_user_id !== viewerUserId) {
      throw new OfferServiceError("forbidden", 403);
    }
    const events = await fetchOfferEvents(client, offerId);
    return buildPublicOffer(row, events);
  } finally {
    client.release();
  }
}

export async function listOffersForListing(listingId: string, sellerUserId: string) {
  const client = await pool.connect();
  try {
    const listing = await loadListing(client, listingId);
    if (String(listing.user_id) !== sellerUserId) {
      throw new OfferServiceError("forbidden", 403);
    }
    const r = await client.query(
      `SELECT o.*, l.title AS listing_title, l.username_display AS seller_display
       FROM listings.offers o
       JOIN listings.listings l ON l.id = o.listing_id
       WHERE o.listing_id = $1::uuid
       ORDER BY o.created_at DESC`,
      [listingId],
    );
    const out: Record<string, unknown>[] = [];
    for (const row of r.rows as OfferRow[]) {
      const events = await fetchOfferEvents(client, row.id);
      out.push(await buildPublicOffer(row, events));
    }
    return { items: out, total: out.length };
  } finally {
    client.release();
  }
}

export async function listOffersMineForListing(
  listingId: string,
  buyerUserId: string,
) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT o.*, l.title AS listing_title, l.username_display AS seller_display
       FROM listings.offers o
       JOIN listings.listings l ON l.id = o.listing_id
       WHERE o.listing_id = $1::uuid AND o.buyer_user_id = $2::uuid
       ORDER BY o.created_at DESC`,
      [listingId, buyerUserId],
    );
    const out: Record<string, unknown>[] = [];
    for (const row of r.rows as OfferRow[]) {
      const events = await fetchOfferEvents(client, row.id);
      out.push(await buildPublicOffer(row, events));
    }
    return { items: out, total: out.length };
  } finally {
    client.release();
  }
}

export async function listOffersMine(userId: string) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT o.*, l.title AS listing_title, l.username_display AS seller_display
       FROM listings.offers o
       JOIN listings.listings l ON l.id = o.listing_id
       WHERE o.buyer_user_id = $1::uuid OR o.seller_user_id = $1::uuid
       ORDER BY o.updated_at DESC
       LIMIT 100`,
      [userId],
    );
    const out: Record<string, unknown>[] = [];
    for (const row of r.rows as OfferRow[]) {
      const events = await fetchOfferEvents(client, row.id);
      out.push(await buildPublicOffer(row, events));
    }
    return { items: out, total: out.length };
  } finally {
    client.release();
  }
}

export async function listingOfferStats(
  listingId: string,
): Promise<{ offerCount: number; bestOfferDisplay: string | null }> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT COUNT(*)::int AS c, MAX(amount_cents) AS best
       FROM listings.offers
       WHERE listing_id = $1::uuid AND status IN ('pending', 'countered')`,
      [listingId],
    );
    const c = Number(r.rows[0]?.c ?? 0);
    const best = r.rows[0]?.best != null ? Number(r.rows[0].best) : null;
    const { formatMoneyFromCents } = await import("./listing-public-contract.js");
    return {
      offerCount: c,
      bestOfferDisplay: best != null && Number.isFinite(best) ? formatMoneyFromCents(best) : null,
    };
  } finally {
    client.release();
  }
}

export async function upsertOfferSettingsFromListing(
  client: PoolClient,
  listingId: string,
  listing: ListingContext,
): Promise<void> {
  const settings = await loadOfferSettings(client, listing);
  await client.query(
    `INSERT INTO listings.offer_settings
       (listing_id, obo_enabled, max_offer_attempts, min_auto_accept_cents, min_auto_reject_cents,
        offer_expiration_hours, allow_counteroffers)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (listing_id) DO UPDATE SET
       obo_enabled = EXCLUDED.obo_enabled,
       max_offer_attempts = EXCLUDED.max_offer_attempts,
       min_auto_accept_cents = EXCLUDED.min_auto_accept_cents,
       min_auto_reject_cents = EXCLUDED.min_auto_reject_cents,
       offer_expiration_hours = EXCLUDED.offer_expiration_hours,
       allow_counteroffers = EXCLUDED.allow_counteroffers,
       updated_at = now()`,
    [
      listingId,
      settings.obo_enabled,
      settings.max_offer_attempts,
      settings.min_auto_accept_cents,
      settings.min_auto_reject_cents,
      settings.offer_expiration_hours,
      settings.allow_counteroffers,
    ],
  );
}
