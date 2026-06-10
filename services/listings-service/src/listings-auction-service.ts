/**
 * Auction bidding lifecycle — proxy engine, close, outbox/Kafka, cart reservation.
 */
import type { PoolClient } from "pg";
import { pool } from "./lib/db.js";
import { formatMoneyFromCents } from "./listing-public-contract.js";
import { parseRpListingFields } from "./rp-listing-fields.js";
import {
  buildPublicAuctionState,
  buildPublicBidHistoryItem,
  type AuctionSettingsRow,
  type BidRow,
} from "./listings-auction-contract.js";
import { resolveMarketplaceUserDisplay } from "./listings-offers-contract.js";
import {
  computeProxySettlement,
  minimumNextBidCents,
  type ProxyBidInput,
} from "./listings-auction-proxy.js";
import {
  insertAuctionOutboxRow,
  markAuctionOutboxPublished,
  newAuctionEventId,
  publishAuctionOutboxAndKafka,
  type AuctionKafkaEventType,
} from "./listings-auction-outbox.js";
import { reserveAuctionWinInCart } from "./shopping-cart-client.js";

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

export class AuctionServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function amenityInt(map: Record<string, string>, key: string, fallback: number): number {
  const v = Number(map[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

async function loadListing(client: PoolClient, listingId: string): Promise<ListingContext> {
  const r = await client.query(
    `SELECT id, user_id, title, price_cents, status::text AS status, pricing_mode, amenities,
            username_display, deleted_at
     FROM listings.listings WHERE id = $1::uuid`,
    [listingId],
  );
  const row = r.rows[0] as ListingContext | undefined;
  if (!row || row.deleted_at) throw new AuctionServiceError("listing not found", 404);
  return row;
}

function defaultEndsAt(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function ensureAuctionSettings(
  client: PoolClient,
  listing: ListingContext,
): Promise<AuctionSettingsRow> {
  const cur = await client.query(
    `SELECT * FROM listings.auction_settings WHERE listing_id = $1::uuid`,
    [listing.id],
  );
  if (cur.rows[0]) return cur.rows[0] as AuctionSettingsRow;

  const rp = parseRpListingFields(listing as Record<string, unknown>);
  const pm = String(listing.pricing_mode || "fixed").toLowerCase();
  const isAuction = rp.saleType === "auction" || pm === "auction";
  if (!isAuction) throw new AuctionServiceError("not an auction listing", 400);

  const starting =
    rp.startingBidCents != null && Number.isFinite(Number(rp.startingBidCents))
      ? Math.max(100, Math.floor(Number(rp.startingBidCents)))
      : Math.max(100, Math.floor(Number(listing.price_cents) || 1000));
  const reserve =
    rp.reservePriceCents != null && Number.isFinite(Number(rp.reservePriceCents))
      ? Math.floor(Number(rp.reservePriceCents))
      : null;
  const amenityMap = (() => {
    const raw = listing.amenities;
    const out: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const s = String(entry);
        const i = s.indexOf(":");
        if (i > 0) out[s.slice(0, i)] = s.slice(i + 1);
      }
    }
    return out;
  })();
  const increment = amenityInt(amenityMap, "bid_increment_cents", 100);
  const startsAt = rp.auctionStartsAt ? new Date(rp.auctionStartsAt) : new Date();
  const endsAt = rp.auctionEndsAt ? new Date(rp.auctionEndsAt) : new Date(defaultEndsAt());
  if (!Number.isFinite(endsAt.getTime())) {
    throw new AuctionServiceError("invalid auction end time", 400);
  }

  const ins = await client.query(
    `INSERT INTO listings.auction_settings
       (listing_id, starting_bid_cents, bid_increment_cents, reserve_cents, starts_at, ends_at, status)
     VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6::timestamptz, 'active')
     ON CONFLICT (listing_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [listing.id, starting, increment, reserve, startsAt.toISOString(), endsAt.toISOString()],
  );
  return ins.rows[0] as AuctionSettingsRow;
}

async function insertBidEvent(
  client: PoolClient,
  input: {
    listingId: string;
    bidId?: string | null;
    actorUserId: string;
    eventType: string;
    amountCents?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO listings.bid_events
       (listing_id, bid_id, actor_user_id, event_type, amount_cents, metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)`,
    [
      input.listingId,
      input.bidId ?? null,
      input.actorUserId,
      input.eventType,
      input.amountCents ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function queueAuctionOutbox(
  client: PoolClient,
  input: {
    eventType: AuctionKafkaEventType;
    listingId: string;
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const eventId = newAuctionEventId();
  await insertAuctionOutboxRow(client, {
    eventId,
    aggregateId: input.listingId,
    eventType: input.eventType,
    payload: input.payload,
  });
  try {
    await publishAuctionOutboxAndKafka({
      eventId,
      listingId: input.listingId,
      eventType: input.eventType,
      payload: input.payload,
    });
    await markAuctionOutboxPublished(client, eventId);
  } catch (e) {
    console.error("[listings-auction] kafka publish failed; outbox row retained", e);
  }
  return eventId;
}

function assertAuctionActive(settings: AuctionSettingsRow): void {
  if (settings.status !== "active") {
    throw new AuctionServiceError("auction is not active", 400);
  }
  const ends = Date.parse(
    settings.ends_at instanceof Date ? settings.ends_at.toISOString() : String(settings.ends_at),
  );
  if (Number.isFinite(ends) && ends <= Date.now()) {
    throw new AuctionServiceError("auction has ended", 400);
  }
}

async function maybeEmitAuctionEndingSoon(
  client: PoolClient,
  listing: ListingContext,
  settings: AuctionSettingsRow,
): Promise<void> {
  if (String(settings.status) !== "active") return;
  const endsMs = Date.parse(
    settings.ends_at instanceof Date ? settings.ends_at.toISOString() : String(settings.ends_at),
  );
  if (!Number.isFinite(endsMs)) return;
  const remainingMs = endsMs - Date.now();
  if (remainingMs <= 0 || remainingMs > 60 * 60 * 1000) return;

  const prior = await client.query(
    `SELECT 1 FROM listings.outbox_events
     WHERE aggregate_id = $1 AND type = 'AuctionEndingSoon' LIMIT 1`,
    [listing.id],
  );
  if (prior.rows.length > 0) return;

  const listingTitle = listing.title ?? "listing";
  const mins = Math.max(1, Math.ceil(remainingMs / 60_000));
  const body = `${listingTitle} ends in about ${mins} minute${mins === 1 ? "" : "s"}`;
  const basePayload = {
    listing_id: listing.id,
    listing_title: listingTitle,
    seller_user_id: listing.user_id,
    ends_at:
      settings.ends_at instanceof Date ? settings.ends_at.toISOString() : String(settings.ends_at),
    title: "Auction ending soon",
    body,
  };

  await queueAuctionOutbox(client, {
    eventType: "AuctionEndingSoon",
    listingId: listing.id,
    payload: { ...basePayload, recipient_role: "seller" },
  });

  if (settings.high_bidder_user_id) {
    await queueAuctionOutbox(client, {
      eventType: "AuctionEndingSoon",
      listingId: listing.id,
      payload: {
        ...basePayload,
        high_bidder_user_id: settings.high_bidder_user_id,
        recipient_role: "bidder",
      },
    });
  }
}

export async function getAuctionStateForListing(
  listingId: string,
  viewerUserId?: string | null,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    const listing = await loadListing(client, listingId);
    const settings = await ensureAuctionSettings(client, listing);
    try {
      await maybeEmitAuctionEndingSoon(client, listing, settings);
    } catch (e) {
      console.warn("[listings-auction] ending-soon notification skipped", e);
    }
    return buildPublicAuctionState(settings, {
      viewerUserId,
      listingTitle: listing.title,
    });
  } finally {
    client.release();
  }
}

export async function listAuctionBids(
  listingId: string,
  viewerUserId?: string | null,
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const client = await pool.connect();
  try {
    const listing = await loadListing(client, listingId);
    const settings = await ensureAuctionSettings(client, listing);
    const r = await client.query(
      `SELECT * FROM listings.bids WHERE listing_id = $1::uuid ORDER BY created_at DESC LIMIT 100`,
      [listingId],
    );
    const items = await Promise.all(
      (r.rows as BidRow[]).map((row) =>
        buildPublicBidHistoryItem(row, settings.high_bidder_user_id),
      ),
    );
    void viewerUserId;
    return { items, total: items.length };
  } finally {
    client.release();
  }
}

export async function placeAuctionBid(input: {
  listingId: string;
  bidderUserId: string;
  amountCents?: number | null;
  maxBidCents?: number | null;
  useProxy?: boolean;
}): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const listing = await loadListing(client, input.listingId);
    if (String(listing.user_id).trim().toLowerCase() === String(input.bidderUserId).trim().toLowerCase()) {
      throw new AuctionServiceError("seller cannot bid on own listing", 403);
    }
    const settings = await ensureAuctionSettings(client, listing);
    assertAuctionActive(settings);

    const useProxy = input.useProxy === true || input.maxBidCents != null;
    const maxBidCents = useProxy
      ? Math.floor(Number(input.maxBidCents ?? input.amountCents))
      : Math.floor(Number(input.amountCents ?? input.maxBidCents));
    if (!Number.isFinite(maxBidCents) || maxBidCents <= 0) {
      throw new AuctionServiceError("invalid bid amount", 400);
    }

    const minBid = minimumNextBidCents({
      startingBidCents: settings.starting_bid_cents,
      currentBidCents: settings.current_bid_cents,
      bidIncrementCents: settings.bid_increment_cents,
      hasBids: settings.bid_count > 0,
    });
    if (maxBidCents < minBid) {
      throw new AuctionServiceError(
        `bid must be at least ${formatMoneyFromCents(minBid)}`,
        400,
      );
    }

    const proxyRows = await client.query(
      `SELECT bidder_user_id, max_bid_cents FROM listings.proxy_bids WHERE listing_id = $1::uuid`,
      [input.listingId],
    );
    const proxies: ProxyBidInput[] = (proxyRows.rows as { bidder_user_id: string; max_bid_cents: number }[]).map(
      (r) => ({ bidderUserId: r.bidder_user_id, maxBidCents: r.max_bid_cents }),
    );

    await client.query(
      `INSERT INTO listings.proxy_bids (listing_id, bidder_user_id, max_bid_cents)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (listing_id, bidder_user_id)
       DO UPDATE SET max_bid_cents = GREATEST(listings.proxy_bids.max_bid_cents, EXCLUDED.max_bid_cents), updated_at = now()`,
      [input.listingId, input.bidderUserId, maxBidCents],
    );

    const settlement = computeProxySettlement({
      startingBidCents: settings.starting_bid_cents,
      bidIncrementCents: settings.bid_increment_cents,
      reserveCents: settings.reserve_cents,
      previousCurrentBidCents: settings.current_bid_cents,
      previousHighBidderId: settings.high_bidder_user_id,
      proxies,
      newBidderUserId: input.bidderUserId,
      newMaxBidCents: maxBidCents,
      bidSource: useProxy ? "proxy_auto" : "manual",
    });

    if (settlement.increments.length === 0) {
      throw new AuctionServiceError("bid did not raise current price", 400);
    }

    let bidCount = settings.bid_count;
    let lastBidId: string | null = null;
    for (const inc of settlement.increments) {
      const ins = await client.query(
        `INSERT INTO listings.bids (listing_id, bidder_user_id, amount_cents, bid_source)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         RETURNING id`,
        [input.listingId, inc.bidderUserId, inc.amountCents, inc.bidSource],
      );
      lastBidId = (ins.rows[0] as { id: string }).id;
      bidCount += 1;
      await insertBidEvent(client, {
        listingId: input.listingId,
        bidId: lastBidId,
        actorUserId: inc.bidderUserId,
        eventType: "bid_placed",
        amountCents: inc.amountCents,
        metadata: { bid_source: inc.bidSource },
      });
    }

    await client.query(
      `UPDATE listings.auction_settings
       SET current_bid_cents = $2,
           bid_count = $3,
           high_bidder_user_id = $4::uuid,
           reserve_met = $5,
           updated_at = now()
       WHERE listing_id = $1::uuid`,
      [
        input.listingId,
        settlement.currentBidCents,
        bidCount,
        settlement.highBidderUserId,
        settlement.reserveMet,
      ],
    );

    const listingTitle = listing.title ?? "listing";
    const amountDisplay = formatMoneyFromCents(settlement.currentBidCents);
    const bidderDisplay = await resolveMarketplaceUserDisplay(input.bidderUserId);

    await queueAuctionOutbox(client, {
      eventType: "BidPlaced",
      listingId: input.listingId,
      payload: {
        listing_id: input.listingId,
        listing_title: listingTitle,
        bidder_user_id: input.bidderUserId,
        bidder_display: bidderDisplay,
        amount_cents: settlement.currentBidCents,
        amount_display: amountDisplay,
        bid_count: bidCount,
        title: "New bid placed",
        body: `${amountDisplay} bid on ${listingTitle}`,
        seller_user_id: listing.user_id,
      },
    });

    for (const outbidId of settlement.outbidUserIds) {
      await insertBidEvent(client, {
        listingId: input.listingId,
        actorUserId: outbidId,
        eventType: "outbid",
        amountCents: settlement.currentBidCents,
      });
      await queueAuctionOutbox(client, {
        eventType: "AuctionOutbid",
        listingId: input.listingId,
        payload: {
          listing_id: input.listingId,
          listing_title: listingTitle,
          outbid_user_id: outbidId,
          amount_cents: settlement.currentBidCents,
          amount_display: amountDisplay,
          title: "You were outbid",
          body: `You were outbid on ${listingTitle}. Current bid is ${amountDisplay}.`,
        },
      });
    }

    await client.query("COMMIT");

    const refreshed = await client.query(
      `SELECT * FROM listings.auction_settings WHERE listing_id = $1::uuid`,
      [input.listingId],
    );
    return buildPublicAuctionState(refreshed.rows[0] as AuctionSettingsRow, {
      viewerUserId: input.bidderUserId,
      listingTitle: listing.title,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closeAuction(
  listingId: string,
  opts: { force?: boolean } = {},
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const listing = await loadListing(client, listingId);
    const settings = await ensureAuctionSettings(client, listing);

    if (settings.status === "ended") {
      await client.query("COMMIT");
      return buildPublicAuctionState(settings, { listingTitle: listing.title });
    }

    const ends = Date.parse(
      settings.ends_at instanceof Date ? settings.ends_at.toISOString() : String(settings.ends_at),
    );
    if (!opts.force && Number.isFinite(ends) && ends > Date.now()) {
      throw new AuctionServiceError("auction has not ended yet", 400);
    }

    const winnerId = settings.high_bidder_user_id;
    const finalCents =
      settings.current_bid_cents > 0
        ? settings.current_bid_cents
        : settings.starting_bid_cents;
    const hasWinner = Boolean(winnerId) && settings.bid_count > 0 && settings.reserve_met;

    await client.query(
      `UPDATE listings.auction_settings
       SET status = 'ended',
           winner_user_id = $2::uuid,
           finalized_at = now(),
           updated_at = now()
       WHERE listing_id = $1::uuid`,
      [listingId, hasWinner ? winnerId : null],
    );

    if (hasWinner && winnerId) {
      await client.query(
        `UPDATE listings.listings
         SET status = 'closed'::listings.listing_status,
             updated_at = now()
         WHERE id = $1::uuid`,
        [listingId],
      );
      await reserveAuctionWinInCart({
        buyerUserId: winnerId,
        listingId,
        amountCents: finalCents,
        listingTitle: listing.title,
        sellerDisplay: listing.username_display,
      });
    }

    const listingTitle = listing.title ?? "listing";
    const amountDisplay = formatMoneyFromCents(finalCents);

    await insertBidEvent(client, {
      listingId,
      actorUserId: listing.user_id,
      eventType: "auction_ended",
      amountCents: finalCents,
      metadata: { winner_user_id: winnerId, has_winner: hasWinner },
    });

    await queueAuctionOutbox(client, {
      eventType: "AuctionEnded",
      listingId,
      payload: {
        listing_id: listingId,
        listing_title: listingTitle,
        amount_cents: finalCents,
        amount_display: amountDisplay,
        has_winner: hasWinner,
        title: "Auction ended",
        body: hasWinner
          ? `${listingTitle} sold for ${amountDisplay}`
          : `${listingTitle} ended with no winner`,
        seller_user_id: listing.user_id,
      },
    });

    if (hasWinner && winnerId) {
      await insertBidEvent(client, {
        listingId,
        actorUserId: winnerId,
        eventType: "auction_won",
        amountCents: finalCents,
      });
      await queueAuctionOutbox(client, {
        eventType: "AuctionWon",
        listingId,
        payload: {
          listing_id: listingId,
          listing_title: listingTitle,
          winner_user_id: winnerId,
          amount_cents: finalCents,
          amount_display: amountDisplay,
          title: "You won the auction",
          body: `You won ${listingTitle} for ${amountDisplay}`,
        },
      });
      await queueAuctionOutbox(client, {
        eventType: "AuctionSold",
        listingId,
        payload: {
          listing_id: listingId,
          listing_title: listingTitle,
          seller_user_id: listing.user_id,
          winner_user_id: winnerId,
          amount_cents: finalCents,
          amount_display: amountDisplay,
          title: "Item sold",
          body: `${listingTitle} sold for ${amountDisplay}`,
        },
      });

      const losers = await client.query(
        `SELECT DISTINCT bidder_user_id FROM listings.proxy_bids
         WHERE listing_id = $1::uuid AND bidder_user_id <> $2::uuid`,
        [listingId, winnerId],
      );
      for (const row of losers.rows as { bidder_user_id: string }[]) {
        await insertBidEvent(client, {
          listingId,
          actorUserId: row.bidder_user_id,
          eventType: "auction_lost",
          amountCents: finalCents,
        });
        await queueAuctionOutbox(client, {
          eventType: "AuctionLost",
          listingId,
          payload: {
            listing_id: listingId,
            listing_title: listingTitle,
            loser_user_id: row.bidder_user_id,
            amount_cents: finalCents,
            amount_display: amountDisplay,
            title: "Auction ended — you did not win",
            body: `You did not win ${listingTitle}. Winning bid was ${amountDisplay}.`,
          },
        });
      }
    } else {
      const bidders = await client.query(
        `SELECT DISTINCT bidder_user_id FROM listings.proxy_bids WHERE listing_id = $1::uuid`,
        [listingId],
      );
      for (const row of bidders.rows as { bidder_user_id: string }[]) {
        await queueAuctionOutbox(client, {
          eventType: "AuctionLost",
          listingId,
          payload: {
            listing_id: listingId,
            listing_title: listingTitle,
            loser_user_id: row.bidder_user_id,
            title: "Auction ended — no sale",
            body: `${listingTitle} ended without meeting reserve.`,
          },
        });
      }
    }

    await client.query("COMMIT");

    const refreshed = await client.query(
      `SELECT * FROM listings.auction_settings WHERE listing_id = $1::uuid`,
      [listingId],
    );
    return buildPublicAuctionState(refreshed.rows[0] as AuctionSettingsRow, {
      listingTitle: listing.title,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Batch auction stats for browse/search enrichment. */
export async function fetchAuctionStatsByListingId(
  ids: string[],
): Promise<
  Record<
    string,
    {
      current_bid_cents: number;
      bid_count: number;
      ends_at: string;
      status: string;
      starting_bid_cents: number;
    }
  >
> {
  if (!ids.length) return {};
  const r = await pool.query(
    `SELECT listing_id, current_bid_cents, bid_count, ends_at, status, starting_bid_cents
     FROM listings.auction_settings WHERE listing_id = ANY($1::uuid[])`,
    [ids],
  );
  const out: Record<string, {
    current_bid_cents: number;
    bid_count: number;
    ends_at: string;
    status: string;
    starting_bid_cents: number;
  }> = {};
  for (const row of r.rows as AuctionSettingsRow[]) {
    out[String(row.listing_id)] = {
      current_bid_cents: row.current_bid_cents,
      bid_count: row.bid_count,
      ends_at: row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at),
      status: row.status,
      starting_bid_cents: row.starting_bid_cents,
    };
  }
  return out;
}
