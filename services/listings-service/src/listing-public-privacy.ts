/**
 * Record Platform public listing contract — no street address, exact coordinates,
 * or contact fields on anonymous marketplace responses.
 */

/** Keys that must never appear on public listing/search JSON. */
export const PUBLIC_LISTING_FORBIDDEN_KEYS = [
  "address_line1",
  "address_line2",
  "postal_code",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "email",
  "phone",
  "phone_number",
  "seller_email",
  "seller_phone",
  "geocode_raw",
  "internal_notes",
  "moderation_notes",
] as const;

/** Housing-only fields quarantined from RP marketplace UI/API. */
export const PUBLIC_LISTING_HOUSING_ONLY_KEYS = [
  "bedrooms",
  "bathrooms",
  "lease_length_months",
  "effective_from",
  "effective_until",
  "distance_miles_to_campus",
  "residence_type",
  "price_usd_monthly",
  "landlord_id",
  "landlord_display",
  "amenities",
  "smoke_free",
  "pet_friendly",
  "furnished",
  "lease_terms",
  "listing_on_hold",
  "soft_hold_until",
  "availability_status",
] as const;

const FORBIDDEN_SET = new Set<string>([
  ...PUBLIC_LISTING_FORBIDDEN_KEYS,
  ...PUBLIC_LISTING_HOUSING_ONLY_KEYS,
]);

export type PublicListingShapeOptions = {
  /** When true, owner/admin view may include private address fields (never on anonymous browse). */
  includePrivateAddress?: boolean;
  /** When true, keep internal user_id for owner flows. */
  includeOwnerIds?: boolean;
};

/**
 * Strip forbidden keys and normalize seller location fields for public JSON.
 */
export function toPublicListingShape(
  row: Record<string, unknown>,
  opts: PublicListingShapeOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };

  const addressKeys = new Set([
    "address_line1",
    "address_line2",
    "postal_code",
    "latitude",
    "longitude",
    "lat",
    "lng",
  ]);
  for (const k of PUBLIC_LISTING_FORBIDDEN_KEYS) {
    if (opts.includePrivateAddress && addressKeys.has(k)) continue;
    delete out[k];
  }
  if (!opts.includePrivateAddress) {
    for (const k of addressKeys) delete out[k];
  }
  if (!opts.includeOwnerIds) {
    delete out.user_id;
    delete out.landlord_id;
  }

  for (const k of PUBLIC_LISTING_HOUSING_ONLY_KEYS) {
    delete out[k];
  }

  const city = row.city != null ? String(row.city).trim() : "";
  const region = row.state_or_province != null ? String(row.state_or_province).trim() : "";
  const country = row.country != null ? String(row.country).trim() : "";
  if (city) out.seller_city = city.slice(0, 120);
  if (region) out.seller_region = region.slice(0, 120);
  if (country) out.seller_country = country.slice(0, 80);

  const approx =
    (row.approximate_location_label != null && String(row.approximate_location_label).trim()) ||
    (row.display_location != null && String(row.display_location).trim()) ||
    (row.location != null && String(row.location).trim()) ||
    (row.neighborhood != null && String(row.neighborhood).trim()) ||
    "";
  const cityRegionCountry = [city, region, country].filter(Boolean).join(", ");
  const label = approx || cityRegionCountry;
  if (label) out.approximate_location_label = String(label).slice(0, 240);

  return out;
}

/** Test helper: true if object contains any forbidden key at top level (nested optional). */
export function publicListingResponseLeaksPrivateData(
  payload: unknown,
  depth = 0,
): string | null {
  if (payload == null || depth > 4) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = publicListingResponseLeaksPrivateData(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (FORBIDDEN_SET.has(key) || PUBLIC_LISTING_FORBIDDEN_KEYS.includes(key as never)) {
      return key;
    }
    const nested = publicListingResponseLeaksPrivateData(o[key], depth + 1);
    if (nested) return `${key}.${nested}`;
  }
  return null;
}
