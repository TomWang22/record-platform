/**
 * Public auction API contract — masked bidders, no proxy max exposure.
 */
import { formatMoneyFromCents, formatPublicTimestamp } from "./listing-public-contract.js";
import { resolveMarketplaceUserDisplay } from "./listings-offers-contract.js";

export type AuctionSettingsRow = {
  listing_id: string;
  starting_bid_cents: number;
  bid_increment_cents: number;
  reserve_cents: number | null;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
  current_bid_cents: number;
  bid_count: number;
  high_bidder_user_id: string | null;
  reserve_met: boolean;
  winner_user_id: string | null;
  finalized_at: Date | string | null;
};

export type BidRow = {
  id: string;
  listing_id: string;
  bidder_user_id: string;
  amount_cents: number;
  bid_source: string;
  created_at: Date | string;
};

export type BidEventRow = {
  id: string;
  listing_id: string;
  bid_id: string | null;
  actor_user_id: string;
  event_type: string;
  amount_cents: number | null;
  metadata?: Record<string, unknown>;
  created_at: Date | string;
};

const BID_SOURCE_DISPLAY: Record<string, string> = {
  manual: "Manual",
  proxy_auto: "Auto (proxy)",
};

export function maskBidderDisplay(userId: string, highBidderId?: string | null): string {
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return "Bidder";
  const tail = id.replace(/-/g, "").slice(-4).toUpperCase();
  if (highBidderId && id === String(highBidderId).trim().toLowerCase()) {
    return `High bidder ····${tail}`;
  }
  return `Bidder ····${tail}`;
}

export function computeTimeLeftMs(endsAt: Date | string): number {
  const ms = Date.parse(endsAt instanceof Date ? endsAt.toISOString() : String(endsAt));
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, ms - Date.now());
}

export function formatTimeLeftDisplay(endsAt: Date | string): string {
  const left = computeTimeLeftMs(endsAt);
  if (left <= 0) return "Ended";
  const hours = Math.floor(left / 3_600_000);
  if (hours < 1) return "<1h left";
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

export async function buildPublicAuctionState(
  row: AuctionSettingsRow,
  opts: { viewerUserId?: string | null; listingTitle?: string | null } = {},
): Promise<Record<string, unknown>> {
  const endsIso =
    row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at);
  const startsIso =
    row.starts_at instanceof Date ? row.starts_at.toISOString() : String(row.starts_at);
  const endsFmt = formatPublicTimestamp(endsIso);
  const current =
    row.current_bid_cents > 0 ? row.current_bid_cents : row.starting_bid_cents;
  const viewer = String(opts.viewerUserId || "").trim().toLowerCase();
  const high = row.high_bidder_user_id
    ? String(row.high_bidder_user_id).trim().toLowerCase()
    : null;
  let viewerState: string | null = null;
  if (row.status === "ended" && viewer) {
    if (row.winner_user_id && viewer === String(row.winner_user_id).trim().toLowerCase()) {
      viewerState = "won";
    } else if (high && viewer !== high) {
      viewerState = "lost";
    } else if (high && viewer === high && !row.winner_user_id) {
      viewerState = "lost";
    }
  } else if (row.status === "active" && high && viewer === high) {
    viewerState = "winning";
  } else if (row.status === "active" && viewer) {
    viewerState = "not_winning";
  }

  return {
    listingId: row.listing_id,
    listingTitle: opts.listingTitle ?? null,
    auctionEnabled: true,
    status: row.status,
    statusDisplay: row.status === "ended" ? "Ended" : row.status === "active" ? "Active" : row.status,
    startingBidDisplay: formatMoneyFromCents(row.starting_bid_cents),
    currentBidDisplay: formatMoneyFromCents(current),
    currentBidCents: current,
    bidCount: row.bid_count,
    bidIncrementDisplay: formatMoneyFromCents(row.bid_increment_cents),
    bidIncrementCents: row.bid_increment_cents,
    reserveMet: row.reserve_met,
    endsAt: endsFmt.at,
    endsAtDisplay: endsFmt.display,
    startsAt: formatPublicTimestamp(startsIso).at,
    timeLeft: formatTimeLeftDisplay(row.ends_at),
    timeLeftMs: computeTimeLeftMs(row.ends_at),
    highBidderMasked: high ? maskBidderDisplay(high, high) : null,
    viewerState,
    winnerMasked:
      row.winner_user_id != null
        ? maskBidderDisplay(String(row.winner_user_id), String(row.winner_user_id))
        : null,
  };
}

export async function buildPublicBidHistoryItem(
  row: BidRow,
  highBidderId?: string | null,
): Promise<Record<string, unknown>> {
  const created = formatPublicTimestamp(
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  );
  const display = await resolveMarketplaceUserDisplay(row.bidder_user_id);
  return {
    id: row.id,
    amountDisplay: formatMoneyFromCents(row.amount_cents),
    bidderMasked: maskBidderDisplay(row.bidder_user_id, highBidderId),
    bidderDisplay: display.startsWith("@") ? display : maskBidderDisplay(row.bidder_user_id, highBidderId),
    bidSource: row.bid_source,
    bidSourceDisplay: BID_SOURCE_DISPLAY[row.bid_source] ?? row.bid_source,
    createdAt: created.at,
    createdAtDisplay: created.display,
  };
}
