/**
 * Single public marketplace listing JSON contract for search, detail, mine, and cards.
 * Internal DB may use cents; public responses must not leak *_cents or housing fields.
 */
import { refreshCommunityImageUrlIfPublicInline } from "./lib/community-media-url.js";
import { formatListingPublicLocation } from "./location-display.js";
import {
  marketplaceSellerDisplay,
  marketplaceSellerUserId,
  PUBLIC_LISTING_HOUSING_ONLY_KEYS,
  toPublicListingShape,
  type PublicListingShapeOptions,
} from "./listing-public-privacy.js";
import { applyRpListingFields, parseRpListingFields } from "./rp-listing-fields.js";

/** Keys stripped from all anonymous/public listing JSON (after mapping). */
export const PUBLIC_LISTING_INTERNAL_KEYS = [
  "price_cents",
  "price_usd_monthly",
  "domestic_shipping_cents",
  "international_shipping_cents",
  "auto_accept_cents",
  "auto_decline_cents",
  "starting_bid_cents",
  "reserve_price_cents",
  "buy_it_now_cents",
  "landlord_id",
  "landlord_display",
  "shipping_service",
  "package_type",
  "local_pickup",
  "combined_shipping",
  "shipping_notes",
  "max_offer_attempts",
  "offer_expiration_hours",
  "auction_starts_at",
  "auction_ends_at",
  "auction_rollover",
  "amenities",
  "smoke_free",
  "pet_friendly",
  "furnished",
  "bedrooms",
  "bathrooms",
  "square_feet",
  "size_sqft",
  "residence_type",
  "effective_from",
  "effective_until",
  "lease_length_months",
  "lease_terms",
  "distance_miles_to_campus",
  "listing_on_hold",
  "soft_hold_until",
  "availability_status",
  "listed_at",
  "created_at",
  "username_display",
  "grade",
  "sleeve_grade",
  "catalog_number",
  "allowOffers",
  "pricing_mode",
] as const;

const INTERNAL_KEY_SET = new Set<string>([
  ...PUBLIC_LISTING_INTERNAL_KEYS,
  ...PUBLIC_LISTING_HOUSING_ONLY_KEYS,
]);

const DISPLAY_TZ =
  (process.env.RP_LISTING_DISPLAY_TZ || "America/New_York").trim() || "America/New_York";

export function formatMoneyFromCents(cents: unknown): string | null {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return `$${(Math.round(n) / 100).toFixed(2)}`;
}

export function formatMoneyFromDollars(dollars: unknown): string | null {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

export function saleTypeDisplay(saleType: string): string {
  const s = String(saleType || "fixed_price").toLowerCase();
  if (s === "auction") return "Auction";
  if (s === "obo" || s === "best_offer") return "Best offer";
  return "Fixed price";
}

function toIsoTimestamp(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export function formatPublicTimestamp(iso: string | null): {
  at: string | null;
  display: string | null;
  timezone: string;
} {
  if (!iso) return { at: null, display: null, timezone: DISPLAY_TZ };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { at: iso, display: iso, timezone: DISPLAY_TZ };
  }
  const datePart = d.toLocaleDateString("en-US", {
    timeZone: DISPLAY_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: DISPLAY_TZ,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const display = `${datePart}, ${timePart}`;
  return { at: d.toISOString(), display, timezone: DISPLAY_TZ };
}

function parseMediaItemsJson(raw: unknown): Array<{
  id: string;
  url_or_path: string;
  media_type: string;
  sort_order: number;
}> {
  if (!raw) return [];
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) arr = p;
    } catch {
      return [];
    }
  }
  const out: Array<{ id: string; url_or_path: string; media_type: string; sort_order: number }> =
    [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = String(o.id ?? "");
    const url_or_path = String(o.url_or_path ?? "");
    if (!id || !url_or_path) continue;
    const media_type = String(o.media_type ?? "image").toLowerCase();
    const so = Number(o.sort_order);
    out.push({
      id,
      url_or_path: refreshCommunityImageUrlIfPublicInline(url_or_path),
      media_type,
      sort_order: Number.isFinite(so) ? Math.floor(so) : out.length,
    });
  }
  return out;
}

export function resolveListingImages(row: Record<string, unknown>): {
  images: string[];
  primaryImageUrl: string | null;
  mediaItems: Array<{
    id: string;
    url_or_path: string;
    media_type: string;
    sort_order: number;
  }>;
} {
  const mediaItems = parseMediaItemsJson(row.media_items_json);
  let images: string[] = [];
  const ij = row.images_json;
  if (Array.isArray(ij)) images = ij.map(String);
  else if (typeof ij === "string") {
    try {
      const p = JSON.parse(ij) as unknown;
      if (Array.isArray(p)) images = p.map(String);
    } catch {
      images = [];
    }
  }
  if (!images.length && mediaItems.length) {
    images = mediaItems.filter((m) => m.media_type === "image").map((m) => m.url_or_path);
  }
  const primaryRaw =
    (typeof row.primary_image_url === "string" && row.primary_image_url.trim()) ||
    (typeof row.primaryImageUrl === "string" && row.primaryImageUrl.trim()) ||
    "";
  if (!images.length && primaryRaw) images = [primaryRaw];
  images = images.map((u) => refreshCommunityImageUrlIfPublicInline(String(u)));
  const primaryImageUrl = images[0] ?? (primaryRaw ? refreshCommunityImageUrlIfPublicInline(primaryRaw) : null);
  if (primaryImageUrl && !images.length) images = [primaryImageUrl];
  return { images, primaryImageUrl, mediaItems };
}

function artistFromRow(row: Record<string, unknown>): string | undefined {
  if (row.artist != null && String(row.artist).trim()) return String(row.artist).trim();
  const rp = parseRpListingFields(row);
  const map = row.amenities;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    const a = (map as Record<string, string>).artist;
    if (a && String(a).trim()) return String(a).trim();
  }
  return undefined;
}

function buildShippingObject(
  rpPayload: Record<string, unknown>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const domesticCents = rpPayload.domestic_shipping_cents ?? null;
  const internationalCents = rpPayload.international_shipping_cents ?? null;
  const domestic =
    domesticCents != null && Number.isFinite(Number(domesticCents))
      ? Math.round(Number(domesticCents)) / 100
      : null;
  const international =
    internationalCents != null && Number.isFinite(Number(internationalCents))
      ? Math.round(Number(internationalCents)) / 100
      : null;
  const shipsFrom =
    (row.display_location != null && String(row.display_location).trim()) ||
    formatListingPublicLocation(row) ||
    null;
  return {
    domestic,
    international,
    domesticDisplay: domestic != null ? formatMoneyFromDollars(domestic) : null,
    internationalDisplay:
      international != null ? formatMoneyFromDollars(international) : null,
    service: rpPayload.shipping_service ?? null,
    package: rpPayload.package_type ?? null,
    shipsFrom,
    localPickup: rpPayload.local_pickup === true,
    combinedShipping: rpPayload.combined_shipping === true,
    notes: rpPayload.shipping_notes ?? null,
  };
}

function stripInternalKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  for (const k of INTERNAL_KEY_SET) delete out[k];
  for (const k of PUBLIC_LISTING_INTERNAL_KEYS) delete out[k];
  return out;
}

export type BuildPublicListingOptions = PublicListingShapeOptions & {
  watchCount?: number;
};

/**
 * Build the canonical public listing object from a DB/search row.
 */
export function buildPublicListingFromRow(
  row: Record<string, unknown>,
  opts: BuildPublicListingOptions = {},
): Record<string, unknown> {
  const { images, primaryImageUrl, mediaItems } = resolveListingImages(row);
  const priceCents = Number(row.price_cents);
  const price = Number.isFinite(priceCents) ? Math.round(priceCents) / 100 : null;
  const listedIso = toIsoTimestamp(row.listed_at ?? row.created_at);
  const updatedIso = toIsoTimestamp(row.updated_at ?? row.listed_at ?? row.created_at);
  const listedFmt = formatPublicTimestamp(listedIso);
  const updatedFmt = formatPublicTimestamp(updatedIso);
  const rp = parseRpListingFields(row);
  const saleType = rp.saleType ?? "fixed_price";
  const status = String(row.status ?? "active").toLowerCase();

  const rpBase = applyRpListingFields(
    {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      status,
      location: formatListingPublicLocation(row),
      city: row.city ?? null,
      state_or_province: row.state_or_province ?? null,
      country: row.country ?? null,
      neighborhood: row.neighborhood ?? null,
      images,
      primaryImageUrl,
      media_items: mediaItems,
      watch_count:
        opts.watchCount ??
        (row.watch_count != null && Number.isFinite(Number(row.watch_count))
          ? Math.max(0, Math.floor(Number(row.watch_count)))
          : 0),
    },
    row,
  );

  const shipping = buildShippingObject(rpBase, row);
  const shippingDisplay =
    typeof rpBase.shipping_summary === "string" && rpBase.shipping_summary.trim()
      ? rpBase.shipping_summary.trim()
      : shipping.service
        ? `${shipping.service}${shipping.domesticDisplay ? ` · ${shipping.domesticDisplay} domestic` : ""}`
        : shipping.shipsFrom
          ? `Ships from ${shipping.shipsFrom}`
          : null;

  const merged: Record<string, unknown> = {
    ...stripInternalKeys(rpBase),
    id: row.id != null ? String(row.id) : null,
    title: row.title != null ? String(row.title) : "",
    artist: artistFromRow(row),
    description: row.description != null ? String(row.description) : "",
    seller: marketplaceSellerDisplay(row),
    seller_id: marketplaceSellerUserId(row) || undefined,
    price,
    priceDisplay: price != null ? formatMoneyFromDollars(price) : null,
    saleType,
    saleTypeDisplay: saleTypeDisplay(saleType),
    shipping,
    shippingDisplay,
    listedAt: listedFmt.at,
    listedAtDisplay: listedFmt.display,
    timezone: listedFmt.timezone,
    updatedAt: updatedFmt.at,
    updatedAtDisplay: updatedFmt.display,
    format: rpBase.format ?? null,
    mediaCondition: rpBase.mediaCondition ?? null,
    sleeveCondition: rpBase.sleeveCondition ?? null,
    images,
    primaryImageUrl,
    media_items: mediaItems,
    mediaItems,
    catalogNumber: rpBase.catalogNumber ?? null,
    label: rpBase.label ?? null,
    subtitle: rpBase.subtitle ?? null,
  };

  return toPublicListingShape(merged, opts);
}

/** True if payload (or nested items) still exposes price_cents or other internal cents keys. */
export function publicListingResponseLeaksInternalPricing(
  payload: unknown,
  depth = 0,
): string | null {
  if (payload == null || depth > 5) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = publicListingResponseLeaksInternalPricing(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key === "price_cents" || key.endsWith("_cents")) return key;
    const nested = publicListingResponseLeaksInternalPricing(o[key], depth + 1);
    if (nested) return `${key}.${nested}`;
  }
  return null;
}
