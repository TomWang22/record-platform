/**
 * Adaptive listings DB export — supports marketplace columns and legacy price_cents/pricing_mode layout.
 * Never exports housing/OCH fields (residence_type, furnished, bedrooms, lease, etc.).
 */
import { columnExists } from './rp-ai-rag-db.mjs';

const PRICING_MODE_MAP = {
  fixed: 'fixed_price',
  obo: 'obo',
  auction: 'auction',
  best_offer: 'obo',
};

export async function buildListingQuery(client, userFilter) {
  const hasPrice = await columnExists(client, 'listings', 'listings', 'price');
  const hasPriceCents = await columnExists(client, 'listings', 'listings', 'price_cents');
  const hasListingType = await columnExists(client, 'listings', 'listings', 'listing_type');
  const hasPricingMode = await columnExists(client, 'listings', 'listings', 'pricing_mode');
  const hasIsActive = await columnExists(client, 'listings', 'listings', 'is_active');
  const hasStatus = await columnExists(client, 'listings', 'listings', 'status');
  const hasDeletedAt = await columnExists(client, 'listings', 'listings', 'deleted_at');
  const hasAmenities = await columnExists(client, 'listings', 'listings', 'amenities');
  const hasCurrency = await columnExists(client, 'listings', 'listings', 'currency');
  const hasCondition = await columnExists(client, 'listings', 'listings', 'condition');
  const hasCategory = await columnExists(client, 'listings', 'listings', 'category');
  const hasLocation = await columnExists(client, 'listings', 'listings', 'location');
  const hasDisplayLocation = await columnExists(client, 'listings', 'listings', 'display_location');

  let priceExpr = 'NULL::numeric';
  if (hasPrice && hasPriceCents) priceExpr = 'COALESCE(l.price, l.price_cents::numeric / 100.0)';
  else if (hasPrice) priceExpr = 'l.price';
  else if (hasPriceCents) priceExpr = 'l.price_cents::numeric / 100.0';

  let typeExpr = "'fixed_price'";
  if (hasListingType && hasPricingMode) typeExpr = "COALESCE(l.listing_type, CASE l.pricing_mode WHEN 'fixed' THEN 'fixed_price' WHEN 'obo' THEN 'obo' WHEN 'auction' THEN 'auction' ELSE l.pricing_mode END)";
  else if (hasListingType) typeExpr = 'l.listing_type';
  else if (hasPricingMode) typeExpr = "CASE l.pricing_mode WHEN 'fixed' THEN 'fixed_price' WHEN 'obo' THEN 'obo' WHEN 'auction' THEN 'auction' ELSE l.pricing_mode END";

  let activeExpr = 'true';
  if (hasIsActive && hasStatus && hasDeletedAt) {
    activeExpr = "(l.is_active AND l.status::text = 'active' AND l.deleted_at IS NULL)";
  } else if (hasIsActive) activeExpr = 'l.is_active';
  else if (hasStatus && hasDeletedAt) activeExpr = "(l.status::text = 'active' AND l.deleted_at IS NULL)";
  else if (hasStatus) activeExpr = "(l.status::text = 'active')";

  const amenitiesExpr = hasAmenities ? 'l.amenities' : "'{}'::jsonb";

  const currencyExpr = hasCurrency ? "COALESCE(l.currency, 'USD')" : "'USD'";
  const conditionExpr = hasCondition ? 'l.condition' : 'NULL::text';
  const categoryExpr = hasCategory ? 'l.category' : 'NULL::text';
  let locationExpr = 'NULL::text';
  if (hasLocation && hasDisplayLocation) locationExpr = 'COALESCE(l.location, l.display_location)';
  else if (hasLocation) locationExpr = 'l.location';
  else if (hasDisplayLocation) locationExpr = 'l.display_location';

  let q = `
    SELECT l.id::text, l.user_id::text, l.title, l.description,
           ${priceExpr} AS price,
           ${currencyExpr} AS currency,
           ${typeExpr} AS listing_type,
           ${conditionExpr} AS condition,
           ${categoryExpr} AS category,
           ${locationExpr} AS location,
           ${activeExpr} AS is_active,
           l.created_at, l.updated_at,
           ${amenitiesExpr} AS amenities
    FROM listings.listings l
    WHERE 1=1`;
  const params = [];
  if (hasDeletedAt) q += ' AND l.deleted_at IS NULL';
  if (userFilter) {
    params.push(userFilter);
    q += ` AND l.user_id = $${params.length}::uuid`;
  }
  q += ' ORDER BY l.updated_at DESC LIMIT 50000';
  return { q, params, hasAmenities };
}

/** Map raw DB row to normalizer input; strip housing-only amenity keys. */
export function mapListingRow(row) {
  const amenities = row.amenities && typeof row.amenities === 'object' ? row.amenities : {};
  const safeAmenityKeys = ['condition', 'category', 'catalog_id', 'format', 'listing_type', 'media_count'];
  const safeAmenities = {};
  for (const k of safeAmenityKeys) {
    if (amenities[k] != null) safeAmenities[k] = amenities[k];
  }
  const listingType = PRICING_MODE_MAP[row.listing_type] ?? row.listing_type ?? 'fixed_price';
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || 'Untitled listing',
    description: row.description,
    price: row.price ?? 0,
    currency: row.currency || 'USD',
    listing_type: listingType,
    condition: row.condition ?? safeAmenities.condition ?? null,
    category: row.category ?? safeAmenities.category ?? null,
    location: row.location ?? null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata_amenities: safeAmenities,
  };
}
