/** RP shipping / sale options parsed from listing amenities (key:value strings). */

import { amenityMapFromRaw } from './listing-amenity-map'

export type ListingShippingInfo = {
  domesticCostCents?: number
  internationalCostCents?: number
  domesticDisplay?: string
  internationalDisplay?: string
  shipsFrom?: string
  service?: string
  packageType?: string
  shipsFromCity?: string
  shipsFromRegion?: string
  shipsFromCountry?: string
  domesticShipping?: boolean
  internationalShipping?: boolean
  localPickup?: boolean
  combinedShipping?: boolean
  notes?: string
}

export type ListingOboSettings = {
  allowOffers?: boolean
  maxOfferAttempts?: number
  offerExpirationHours?: number
  autoAcceptCents?: number
  autoDeclineCents?: number
}

export type ListingAuctionSettings = {
  startingBidCents?: number
  reserveCents?: number
  buyItNowCents?: number
  startsAt?: string
  endsAt?: string
  rolloverMode?: string
}

function parseCents(raw?: string): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}

function parseBool(raw?: string | boolean | number): boolean | undefined {
  if (typeof raw === 'boolean') return raw
  if (raw == null || raw === '') return undefined
  const s = String(raw).toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return undefined
}

function parseShippingFromPublicObject(
  sh: Record<string, unknown>,
): Partial<ListingShippingInfo> {
  const domestic = sh.domestic
  const international = sh.international
  const domesticCostCents =
    domestic != null && Number.isFinite(Number(domestic))
      ? Math.round(Number(domestic) * 100)
      : undefined
  const internationalCostCents =
    international != null && Number.isFinite(Number(international))
      ? Math.round(Number(international) * 100)
      : undefined
  return {
    domesticCostCents,
    internationalCostCents,
    domesticDisplay:
      sh.domesticDisplay != null ? String(sh.domesticDisplay) : undefined,
    internationalDisplay:
      sh.internationalDisplay != null ? String(sh.internationalDisplay) : undefined,
    service: sh.service != null ? String(sh.service) : undefined,
    packageType:
      sh.package != null
        ? String(sh.package)
        : sh.packageType != null
          ? String(sh.packageType)
          : undefined,
    shipsFrom: sh.shipsFrom != null ? String(sh.shipsFrom) : undefined,
    notes: sh.notes != null ? String(sh.notes) : undefined,
    localPickup: parseBool(sh.localPickup),
    combinedShipping: parseBool(sh.combinedShipping),
    domesticShipping: domesticCostCents != null ? true : undefined,
    internationalShipping: internationalCostCents != null ? true : undefined,
  }
}

export function parseShippingFromRow(row: Record<string, unknown>): ListingShippingInfo {
  const nested =
    row.shipping && typeof row.shipping === 'object' && !Array.isArray(row.shipping)
      ? parseShippingFromPublicObject(row.shipping as Record<string, unknown>)
      : {}
  const map = amenityMapFromRaw(row.amenities)
  const city =
    row.seller_city != null
      ? String(row.seller_city)
      : row.city != null
        ? String(row.city)
        : map.ships_from_city ?? map.ship_city
  const region =
    row.seller_region != null
      ? String(row.seller_region)
      : row.state_or_province != null
        ? String(row.state_or_province)
        : map.ships_from_region ?? map.ship_region
  const country =
    row.seller_country != null
      ? String(row.seller_country)
      : row.country != null
        ? String(row.country)
        : map.ships_from_country ?? map.ship_country
  return {
    ...nested,
    domesticCostCents:
      nested.domesticCostCents ??
      parseCents(
        row.domestic_shipping_cents ?? map.domestic_shipping_cents ?? map.domestic_cost_cents,
      ),
    internationalCostCents:
      nested.internationalCostCents ??
      parseCents(
        row.international_shipping_cents ??
          map.international_shipping_cents ??
          map.international_cost_cents,
      ),
    service:
      nested.service ??
      (row.shipping_service != null
        ? String(row.shipping_service)
        : map.shipping_service ?? map.ship_service),
    packageType:
      nested.packageType ??
      (row.package_type != null
        ? String(row.package_type)
        : map.package_type ?? map.shipping_package),
    shipsFromCity: nested.shipsFrom ? undefined : city,
    shipsFromRegion: nested.shipsFrom ? undefined : region,
    shipsFromCountry: nested.shipsFrom ? undefined : country,
    shipsFrom: nested.shipsFrom,
    domesticShipping:
      nested.domesticShipping ?? parseBool(map.domestic_shipping ?? map.ships_domestic),
    internationalShipping:
      nested.internationalShipping ??
      parseBool(map.international_shipping ?? map.ships_international),
    localPickup: nested.localPickup ?? parseBool(map.local_pickup),
    combinedShipping: nested.combinedShipping ?? parseBool(map.combined_shipping),
    notes:
      nested.notes ??
      (row.shipping_notes != null ? String(row.shipping_notes) : map.shipping_notes),
  }
}

export function parseOboFromRow(row: Record<string, unknown>): ListingOboSettings {
  const map = amenityMapFromRaw(row.amenities)
  const max = row.max_offer_attempts ?? map.max_offer_attempts
  const exp = row.offer_expiration_hours ?? map.offer_expiration_hours
  return {
    allowOffers: parseBool(row.allowOffers ?? map.allow_offers) ?? true,
    maxOfferAttempts: max != null && max !== '' ? Number(max) : undefined,
    offerExpirationHours: exp != null && exp !== '' ? Number(exp) : undefined,
    autoAcceptCents: parseCents(row.auto_accept_cents ?? map.auto_accept_cents),
    autoDeclineCents: parseCents(row.auto_decline_cents ?? map.auto_decline_cents),
  }
}

export function parseAuctionFromRow(row: Record<string, unknown>): ListingAuctionSettings {
  const map = amenityMapFromRaw(row.amenities)
  return {
    startingBidCents: parseCents(row.starting_bid_cents ?? map.starting_bid_cents ?? map.auction_start_cents),
    reserveCents: parseCents(row.reserve_price_cents ?? map.reserve_price_cents ?? map.auction_reserve_cents),
    buyItNowCents: parseCents(row.buy_it_now_cents ?? map.buy_it_now_cents),
    startsAt:
      row.auction_starts_at != null
        ? String(row.auction_starts_at)
        : map.auction_starts_at ?? map.auction_start_at,
    endsAt:
      row.auction_ends_at != null ? String(row.auction_ends_at) : map.auction_ends_at ?? map.auction_end_at,
    rolloverMode:
      row.auction_rollover != null
        ? String(row.auction_rollover)
        : map.auction_rollover ?? map.auction_relist_mode,
  }
}

export function resolveSaleMode(row: Record<string, unknown>): 'fixed_price' | 'obo' | 'auction' {
  const map = amenityMapFromRaw(row.amenities)
  const st = String(row.saleType ?? map.sale_type ?? row.pricing_mode ?? '').toLowerCase()
  if (st === 'auction') return 'auction'
  if (st === 'obo' || st === 'best_offer') return 'obo'
  const pm = String(row.pricing_mode ?? '').toLowerCase()
  if (pm === 'obo') return 'obo'
  if (pm === 'auction') return 'auction'
  return 'fixed_price'
}

export function shippingAmenityEntries(shipping: ListingShippingInfo): string[] {
  const out: string[] = []
  const push = (k: string, v: string | number | boolean | undefined) => {
    if (v == null || v === '') return
    out.push(`${k}:${String(v)}`)
  }
  push('domestic_shipping_cents', shipping.domesticCostCents)
  push('international_shipping_cents', shipping.internationalCostCents)
  push('shipping_service', shipping.service)
  push('package_type', shipping.packageType)
  push('ships_from_city', shipping.shipsFromCity)
  push('ships_from_region', shipping.shipsFromRegion)
  push('ships_from_country', shipping.shipsFromCountry)
  push('domestic_shipping', shipping.domesticShipping)
  push('international_shipping', shipping.internationalShipping)
  push('local_pickup', shipping.localPickup)
  push('combined_shipping', shipping.combinedShipping)
  push('shipping_notes', shipping.notes)
  return out
}

export function oboAmenityEntries(obo: ListingOboSettings): string[] {
  const out: string[] = []
  const push = (k: string, v: string | number | boolean | undefined) => {
    if (v == null || v === '') return
    out.push(`${k}:${String(v)}`)
  }
  push('allow_offers', obo.allowOffers)
  push('max_offer_attempts', obo.maxOfferAttempts)
  push('offer_expiration_hours', obo.offerExpirationHours)
  push('auto_accept_cents', obo.autoAcceptCents)
  push('auto_decline_cents', obo.autoDeclineCents)
  return out
}

export function auctionAmenityEntries(auction: ListingAuctionSettings): string[] {
  const out: string[] = []
  const push = (k: string, v: string | number | undefined) => {
    if (v == null || v === '') return
    out.push(`${k}:${String(v)}`)
  }
  push('starting_bid_cents', auction.startingBidCents)
  push('reserve_price_cents', auction.reserveCents)
  push('buy_it_now_cents', auction.buyItNowCents)
  push('auction_starts_at', auction.startsAt)
  push('auction_ends_at', auction.endsAt)
  push('auction_rollover', auction.rolloverMode)
  return out
}
