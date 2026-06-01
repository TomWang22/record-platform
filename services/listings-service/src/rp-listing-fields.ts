/**
 * Record Platform vinyl/media fields derived from amenities JSON and listing metadata.
 * Housing/OCH columns remain in DB for legacy rows but must not surface in RP UI/API.
 */

const HOUSING_RESIDENCE_TYPES = new Set([
  "apartment",
  "house",
  "townhouse",
  "condo",
  "studio",
  "room",
  "duplex",
]);

const FORMAT_IN_TITLE =
  /\b(LP|CD|7[\s-]?inch|7"|10[\s-]?inch|10"|12[\s-]?inch|12"|cassette)\b/i;

export type RpListingFields = {
  format?: string;
  mediaCondition?: string;
  sleeveCondition?: string;
  catalogNumber?: string;
  label?: string;
  pressingYear?: string;
  subtitle?: string;
  saleType?: string;
  allowOffers?: boolean;
  domesticShippingCents?: string;
  internationalShippingCents?: string;
  shippingService?: string;
  packageType?: string;
  localPickup?: string;
  combinedShipping?: string;
  shippingNotes?: string;
  maxOfferAttempts?: string;
  offerExpirationHours?: string;
  autoAcceptCents?: string;
  autoDeclineCents?: string;
  startingBidCents?: string;
  reservePriceCents?: string;
  buyItNowCents?: string;
  auctionStartsAt?: string;
  auctionEndsAt?: string;
  auctionRollover?: string;
  sourceRecordId?: string;
};

function amenityMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = String(item).trim();
      if (!s) continue;
      const colon = s.indexOf(":");
      if (colon > 0) {
        out[s.slice(0, colon).trim().toLowerCase()] = s.slice(colon + 1).trim();
      } else if (s.toLowerCase().startsWith("format=")) {
        out.format = s.slice(7).trim();
      }
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue;
      out[String(k).trim().toLowerCase()] = String(v).trim();
    }
  }
  return out;
}

function pick(map: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = map[k];
    if (v && !HOUSING_RESIDENCE_TYPES.has(v.toLowerCase())) return v;
  }
  return undefined;
}

export function inferFormatFromTitle(title: string): string | undefined {
  const m = title.match(FORMAT_IN_TITLE);
  if (!m) return undefined;
  const f = m[1].toLowerCase();
  if (f.includes("7")) return "7-inch";
  if (f.includes("10")) return "10-inch";
  if (f.includes("12")) return "12-inch";
  return f.toUpperCase() === "CD" ? "CD" : f.toUpperCase() === "LP" ? "LP" : f;
}

/** Never treat housing residence_type as vinyl format. */
export function resolveRpFormat(
  row: Record<string, unknown>,
  amenityFields: Record<string, string>,
): string | undefined {
  const explicit =
    row.format != null
      ? String(row.format).trim()
      : pick(amenityFields, "format", "media_format", "record_format");
  if (explicit && !HOUSING_RESIDENCE_TYPES.has(explicit.toLowerCase())) {
    return explicit;
  }
  const rt = row.residence_type != null ? String(row.residence_type).toLowerCase() : "";
  if (rt && !HOUSING_RESIDENCE_TYPES.has(rt)) return rt;
  return inferFormatFromTitle(String(row.title ?? ""));
}

export function parseRpListingFields(row: Record<string, unknown>): RpListingFields {
  const map = amenityMap(row.amenities);
  const format = resolveRpFormat(row, map);
  const pm = String(row.pricing_mode ?? "fixed").toLowerCase();
  const saleTypeRaw = String(map.sale_type ?? "").toLowerCase();
  const saleType =
    saleTypeRaw === "auction"
      ? "auction"
      : saleTypeRaw === "obo" || pm === "obo"
        ? "obo"
        : "fixed_price";
  return {
    format,
    mediaCondition: pick(map, "media_condition", "mediacondition", "grade", "media_grade"),
    sleeveCondition: pick(map, "sleeve_condition", "sleevecondition", "sleeve_grade"),
    catalogNumber: pick(map, "catalog_number", "catalognumber"),
    label: pick(map, "label"),
    pressingYear: pick(map, "pressing_year", "year"),
    subtitle: pick(map, "subtitle"),
    saleType,
    allowOffers: map.allow_offers === "true" || map.allow_offers === "1",
    domesticShippingCents: map.domestic_shipping_cents,
    internationalShippingCents: map.international_shipping_cents,
    shippingService: map.shipping_service,
    packageType: map.package_type,
    localPickup: map.local_pickup,
    combinedShipping: map.combined_shipping,
    shippingNotes: map.shipping_notes,
    maxOfferAttempts: map.max_offer_attempts,
    offerExpirationHours: map.offer_expiration_hours,
    autoAcceptCents: map.auto_accept_cents,
    autoDeclineCents: map.auto_decline_cents,
    startingBidCents: map.starting_bid_cents,
    reservePriceCents: map.reserve_price_cents,
    buyItNowCents: map.buy_it_now_cents,
    auctionStartsAt: map.auction_starts_at,
    auctionEndsAt: map.auction_ends_at,
    auctionRollover: map.auction_rollover,
    sourceRecordId: pick(map, "source_record_id", "source_record"),
  };
}

/** Merge RP marketplace fields onto a listing JSON object (before public shape strip). */
export function applyRpListingFields(
  payload: Record<string, unknown>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const rp = parseRpListingFields(row);
  const seller =
    String(row.username_display ?? row.seller ?? "").trim() ||
    String(payload.seller ?? "").trim() ||
    "Seller";
  return {
    ...payload,
    seller,
    username_display: row.username_display ?? seller,
    format: rp.format ?? null,
    mediaCondition: rp.mediaCondition ?? null,
    sleeveCondition: rp.sleeveCondition ?? null,
    catalogNumber: rp.catalogNumber ?? null,
    label: rp.label ?? null,
    pressingYear: rp.pressingYear ?? null,
    subtitle: rp.subtitle ?? null,
    seller_id: row.user_id != null ? String(row.user_id) : payload.seller_id ?? null,
    saleType: rp.saleType ?? "fixed_price",
    pricing_mode:
      rp.saleType === "auction" ? "auction" : rp.saleType === "obo" ? "obo" : "fixed",
    allowOffers: rp.allowOffers ?? false,
    domestic_shipping_cents: rp.domesticShippingCents ?? null,
    international_shipping_cents: rp.internationalShippingCents ?? null,
    shipping_service: rp.shippingService ?? null,
    package_type: rp.packageType ?? null,
    local_pickup: rp.localPickup === "true",
    combined_shipping: rp.combinedShipping === "true",
    shipping_notes: rp.shippingNotes ?? null,
    max_offer_attempts: rp.maxOfferAttempts ?? null,
    offer_expiration_hours: rp.offerExpirationHours ?? null,
    auto_accept_cents: rp.autoAcceptCents ?? null,
    auto_decline_cents: rp.autoDeclineCents ?? null,
    starting_bid_cents: rp.startingBidCents ?? null,
    reserve_price_cents: rp.reservePriceCents ?? null,
    buy_it_now_cents: rp.buyItNowCents ?? null,
    auction_starts_at: rp.auctionStartsAt ?? null,
    auction_ends_at: rp.auctionEndsAt ?? null,
    auction_rollover: rp.auctionRollover ?? null,
    source_record_id: rp.sourceRecordId ?? null,
    grade: rp.mediaCondition ?? payload.grade ?? null,
    sleeve_grade: rp.sleeveCondition ?? payload.sleeve_grade ?? null,
    catalog_number: rp.catalogNumber ?? payload.catalog_number ?? null,
    status: String(row.status ?? payload.status ?? "active"),
    shipping_summary:
      payload.shipping_summary ??
      (rp.shippingService
        ? `${rp.shippingService}${rp.domesticShippingCents ? ` · $${(Number(rp.domesticShippingCents) / 100).toFixed(2)} domestic` : ""}`
        : row.display_location
          ? `Ships from ${String(row.display_location)}`
          : null),
  };
}
