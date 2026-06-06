import type { ListingRevision, MarketplaceListing } from './listings-types'

export function formatListingPrice(listing: MarketplaceListing): string {
  if (listing.priceDisplay?.trim()) return listing.priceDisplay.trim()
  const p = listing.price ?? (listing.price_cents != null ? listing.price_cents / 100 : null)
  if (p == null) return '—'
  return `$${p.toFixed(2)}`
}

export function formatListingTimestamp(
  display?: string,
  iso?: string,
  timezone?: string,
): string {
  if (display?.trim()) {
    const d = display.trim()
    if (/EDT|EST|PDT|PST|UTC|GMT|[A-Z]{2,5}$/i.test(d)) return d
    return timezone ? `${d} (${timezone})` : d
  }
  return formatDate(iso)
}

export function saleTypeLabel(t?: string): string {
  switch (String(t ?? '').toLowerCase()) {
    case 'obo':
    case 'best_offer':
      return 'OBO'
    case 'auction':
      return 'Auction'
    case 'fixed_price':
    case 'fixed':
      return 'Fixed price'
    default:
      return 'Fixed price'
  }
}

export function formatMoneyFromCents(cents?: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export function listingStatusLabel(st?: string): string {
  const s = String(st ?? 'active').toLowerCase()
  if (s === 'sold' || s === 'closed') return 'Sold'
  if (s === 'paused') return 'Paused'
  if (s === 'draft') return 'Draft'
  if (s === 'archived') return 'Archived'
  return 'Active'
}

export function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const HOUSING_REVISION_KEYS = new Set([
  'residence_type',
  'landlord_display',
  'landlord_id',
  'tenant',
  'rent',
  'bedrooms',
  'bathrooms',
  'furnished',
  'smoke_free',
  'pet_friendly',
  'size_sqft',
  'lease_length_months',
  'effective_from',
  'effective_until',
  'address_line1',
  'address_line2',
  'postal_code',
  'neighborhood',
])

export function revisionFieldLabel(field: string): string {
  const map: Record<string, string> = {
    title: 'Title',
    description: 'Description',
    price_cents: 'Price',
    pricing_mode: 'Sale type',
    sale_type: 'Sale type',
    status: 'Status',
    amenities: 'Details',
    format: 'Format',
    media_condition: 'Media condition',
    sleeve_condition: 'Sleeve condition',
  }
  return map[field] ?? field.replace(/_/g, ' ')
}

export function displayRevisionValue(field: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (field === 'price_cents') {
    const n = Number(v)
    if (Number.isFinite(n)) return `$${(n / 100).toFixed(2)}`
  }
  if (field === 'pricing_mode') {
    const s = String(v).toLowerCase()
    if (s === 'obo') return 'Best offer'
    if (s === 'auction') return 'Auction'
    return 'Buy it now'
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.action === 'string') return o.action
    return JSON.stringify(v)
  }
  return String(v)
}

export function isHousingRevisionField(field: string): boolean {
  return HOUSING_REVISION_KEYS.has(field)
}

export function parseListingRevisionChanges(
  rev: ListingRevision,
): { fields: string[]; prev: Record<string, unknown>; next: Record<string, unknown> } {
  const ch = rev.changes
  if (ch && typeof ch === 'object' && !Array.isArray(ch)) {
    const obj = ch as Record<string, unknown>
    if (obj.previous && obj.new) {
      return {
        fields: Object.keys(obj.new as object),
        prev: (obj.previous as Record<string, unknown>) ?? {},
        next: (obj.new as Record<string, unknown>) ?? {},
      }
    }
    const prev: Record<string, unknown> = {}
    const next: Record<string, unknown> = {}
    const fields: string[] = []
    for (const [field, val] of Object.entries(obj)) {
      fields.push(field)
      if (val && typeof val === 'object' && !Array.isArray(val) && ('from' in val || 'to' in val)) {
        const o = val as { from?: unknown; to?: unknown }
        prev[field] = o.from
        next[field] = o.to
      } else {
        next[field] = val
      }
    }
    return { fields, prev, next }
  }
  if (typeof ch === 'string') {
    try {
      const p = JSON.parse(ch) as Record<string, unknown>
      return parseListingRevisionChanges({ ...rev, changes: p })
    } catch {
      return { fields: [], prev: {}, next: {} }
    }
  }
  return { fields: [], prev: {}, next: {} }
}
