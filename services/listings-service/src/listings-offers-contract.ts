/**
 * Public OBO offer API contract — no amount_cents or raw UUID labels in UI-facing JSON.
 */
import { formatMoneyFromCents, formatPublicTimestamp } from "./listing-public-contract.js";
import { fetchLandlordHandleFromTrust } from "./trust-username-resolve.js";

export const OFFER_STATUSES = [
  "pending",
  "countered",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

const STATUS_DISPLAY: Record<string, string> = {
  pending: "Pending",
  countered: "Countered",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export type OfferEventRow = {
  id: string;
  offer_id: string;
  listing_id: string;
  actor_user_id: string;
  event_type: string;
  previous_status: string | null;
  new_status: string;
  amount_cents: number | null;
  message: string | null;
  created_at: Date | string;
  metadata?: Record<string, unknown>;
};

export type OfferRow = {
  id: string;
  listing_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  message: string | null;
  expires_at: Date | string | null;
  parent_offer_id: string | null;
  attempt_number: number;
  created_at: Date | string;
  updated_at: Date | string;
  decided_at: Date | string | null;
  listing_title?: string | null;
  buyer_display?: string | null;
  seller_display?: string | null;
};

const displayNameCache = new Map<string, string>();

export async function resolveMarketplaceUserDisplay(
  userId: string,
  snapshot?: string | null,
): Promise<string> {
  const snap = String(snapshot ?? "").trim();
  if (snap && !/^[0-9a-f-]{36}$/i.test(snap)) return snap.slice(0, 120);
  const id = String(userId || "").trim().toLowerCase();
  if (!id) return "User";
  const cached = displayNameCache.get(id);
  if (cached) return cached;
  const trust = await fetchLandlordHandleFromTrust(id);
  const label = trust ? `@${trust.replace(/^@+/, "")}` : "Collector";
  displayNameCache.set(id, label);
  return label;
}

export function offerStatusDisplay(status: string): string {
  return STATUS_DISPLAY[String(status || "").toLowerCase()] ?? "Unknown";
}

export function buildPublicOfferEvent(
  row: OfferEventRow,
  actorDisplay: string,
): Record<string, unknown> {
  const created = formatPublicTimestamp(
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  );
  const amountDisplay =
    row.amount_cents != null && Number.isFinite(Number(row.amount_cents))
      ? formatMoneyFromCents(row.amount_cents)
      : null;
  return {
    id: row.id,
    eventType: row.event_type,
    eventTypeDisplay: offerStatusDisplay(row.event_type),
    actor: actorDisplay,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    newStatusDisplay: offerStatusDisplay(row.new_status),
    amountDisplay,
    message: row.message,
    createdAt: created.at,
    createdAtDisplay: created.display,
    timezone: created.timezone,
  };
}

export async function buildPublicOffer(
  row: OfferRow,
  events: OfferEventRow[] = [],
): Promise<Record<string, unknown>> {
  const buyerDisplay = await resolveMarketplaceUserDisplay(
    row.buyer_user_id,
    row.buyer_display,
  );
  const sellerDisplay = await resolveMarketplaceUserDisplay(
    row.seller_user_id,
    row.seller_display,
  );
  const created = formatPublicTimestamp(
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  );
  const updated = formatPublicTimestamp(
    row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  );
  const expires = row.expires_at
    ? formatPublicTimestamp(
        row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
      )
    : { at: null, display: null, timezone: created.timezone };

  const eventPayloads: Record<string, unknown>[] = [];
  for (const ev of events) {
    const actor =
      ev.actor_user_id === row.buyer_user_id
        ? buyerDisplay
        : ev.actor_user_id === row.seller_user_id
          ? sellerDisplay
          : await resolveMarketplaceUserDisplay(ev.actor_user_id);
    eventPayloads.push(buildPublicOfferEvent(ev, actor));
  }

  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing_title ?? null,
    buyer: buyerDisplay,
    buyerId: row.buyer_user_id,
    seller: sellerDisplay,
    sellerId: row.seller_user_id,
    amountDisplay: formatMoneyFromCents(row.amount_cents),
    status: row.status,
    statusDisplay: offerStatusDisplay(row.status),
    message: row.message,
    expiresAt: expires.at,
    expiresAtDisplay: expires.display,
    attemptNumber: row.attempt_number,
    createdAtDisplay: created.display,
    updatedAtDisplay: updated.display,
    timezone: created.timezone,
    events: eventPayloads,
  };
}

export function buildPublicOfferSettings(input: {
  oboEnabled: boolean;
  maxAttempts: number;
  attemptsRemaining: number | null;
  minOfferCents: number | null;
  offerTtlHours: number;
  allowCounteroffers: boolean;
  listingTitle?: string | null;
}): Record<string, unknown> {
  return {
    oboEnabled: input.oboEnabled,
    maxAttempts: input.maxAttempts,
    attemptsRemaining: input.attemptsRemaining,
    minOfferDisplay:
      input.minOfferCents != null && Number.isFinite(input.minOfferCents)
        ? formatMoneyFromCents(input.minOfferCents)
        : null,
    offerTtlHours: input.offerTtlHours,
    allowCounteroffers: input.allowCounteroffers,
    listingTitle: input.listingTitle ?? null,
  };
}

/** Reject internal cents keys leaking into public offer JSON. */
export function publicOfferResponseLeaksInternal(payload: unknown, depth = 0): string | null {
  if (payload == null || depth > 6) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = publicOfferResponseLeaksInternal(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key === "amount_cents" || key === "price_cents" || key.endsWith("_cents")) return key;
    const nested = publicOfferResponseLeaksInternal(o[key], depth + 1);
    if (nested) return `${key}.${nested}`;
  }
  return null;
}
