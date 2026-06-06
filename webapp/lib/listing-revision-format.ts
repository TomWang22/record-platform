import type { ListingRevision } from './listings-types'
import { displayRevisionValue, isHousingRevisionField, revisionFieldLabel } from './listing-format'

const HOUSING_KEYS = new Set([
  'residence_type',
  'landlord_display',
  'landlord_id',
  'tenant',
  'rent',
  'furnished',
  'effective_from',
  'effective_until',
  'bedrooms',
  'bathrooms',
  'size_sqft',
  'smoke_free',
  'pet_friendly',
  'lease_length_months',
  'address_line1',
  'address_line2',
  'postal_code',
  'neighborhood',
  'soft_hold_until',
])

/** Amenity keys mirrored to top-level RP fields — never diff via amenities blob alone. */
const AMENITY_MIRROR_TOPLEVEL = new Set([
  'format',
  'media_condition',
  'mediacondition',
  'sleeve_condition',
  'sleevecondition',
  'catalog_number',
  'catalognumber',
  'label',
  'pressing_year',
  'subtitle',
  'allow_offers',
  'sale_type',
])

const AMENITY_LABELS: Record<string, string> = {
  shipping_service: 'Shipping service',
  domestic_shipping_cents: 'Domestic shipping',
  international_shipping_cents: 'International shipping',
  local_pickup: 'Local pickup',
  combined_shipping: 'Combined shipping',
  shipping_notes: 'Shipping notes',
  max_offer_attempts: 'Max offer attempts',
  offer_expiration_hours: 'Offer expiration',
  auto_accept_cents: 'Auto-accept amount',
  auto_decline_cents: 'Auto-decline amount',
  auction_ends_at: 'Auction end',
  auction_starts_at: 'Auction start',
  starting_bid_cents: 'Starting bid',
  reserve_price_cents: 'Reserve price',
  buy_it_now_cents: 'Buy it now price',
  sale_type: 'Sale type',
}

function isRawJsonDiffText(s: string): boolean {
  return /^\s*\{/.test(s) || /"to"\s*:/.test(s) || /"from"\s*:/.test(s)
}

function amenityMapFromRaw(v: unknown): Record<string, string> {
  if (v == null) return {}
  if (Array.isArray(v)) {
    const out: Record<string, string> = {}
    for (const item of v) {
      const s = String(item).trim()
      const i = s.indexOf(':')
      if (i > 0) out[s.slice(0, i).toLowerCase()] = s.slice(i + 1).trim()
    }
    return out
  }
  if (typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val != null && String(val).trim() !== '')
        .map(([k, val]) => [k.toLowerCase(), String(val).trim()]),
    )
  }
  return {}
}

function formatAmenityValue(key: string, v?: string): string {
  if (v == null || v === '') return ''
  if (key.endsWith('_cents')) {
    const n = Number(v)
    if (!Number.isFinite(n)) return ''
    return displayRevisionValue('price_cents', n)
  }
  if (key === 'sale_type') {
    const s = String(v ?? '').toLowerCase()
    if (s === 'obo' || s === 'best_offer') return 'Best offer'
    if (s === 'auction') return 'Auction'
    if (s === 'fixed' || s === 'fixed_price') return 'Fixed price'
    return displayRevisionValue('pricing_mode', v)
  }
  if (key.endsWith('_at') || key === 'effective_from' || key === 'effective_until') {
    return formatRevisionDate(v)
  }
  if (key.endsWith('_hours')) {
    const n = Number(v)
    return Number.isFinite(n) ? `${n}h` : v
  }
  if (key.endsWith('_attempts')) {
    const n = Number(v)
    return Number.isFinite(n) ? String(n) : v
  }
  if (v === 'true') return 'Yes'
  if (v === 'false') return 'No'
  return v
}

function displayOrEmpty(field: string, v: unknown): string {
  if (v == null || v === '') return ''
  return displayRevisionValue(field, v)
}

function valuesEqual(field: string, from: unknown, to: unknown): boolean {
  const a = displayOrEmpty(field, from)
  const b = displayOrEmpty(field, to)
  if (a === b) return true
  if (field === 'price_cents') {
    const na = Number(from)
    const nb = Number(to)
    return Number.isFinite(na) && Number.isFinite(nb) && na === nb
  }
  return false
}

/** Skip false "cleared" lines — only show → — when user explicitly cleared (to empty, from had value). */
function isMeaningfulChange(fromDisp: string, toDisp: string): boolean {
  if (fromDisp === toDisp) return false
  if (!fromDisp && !toDisp) return false
  if (fromDisp && !toDisp) return false
  if (!fromDisp && toDisp) return true
  return true
}

function amenityDiffLines(prev: unknown, next: unknown): string[] {
  const pMap = amenityMapFromRaw(prev)
  const nMap = amenityMapFromRaw(next)
  const lines: string[] = []
  const keys = new Set([...Object.keys(pMap), ...Object.keys(nMap)])
  for (const key of keys) {
    if (HOUSING_KEYS.has(key) || AMENITY_MIRROR_TOPLEVEL.has(key)) continue
    const fromDisp = formatAmenityValue(key, pMap[key])
    const toDisp = formatAmenityValue(key, nMap[key])
    if (!isMeaningfulChange(fromDisp, toDisp)) continue
    const label = AMENITY_LABELS[key] ?? revisionFieldLabel(key)
    lines.push(`${label}: ${fromDisp || '—'} → ${toDisp || '—'}`)
  }
  return lines
}

export function formatRevisionDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
  return `${datePart}, ${timePart}`
}

export function parseRevisionFieldDeltas(
  changes: Record<string, unknown>,
): { field: string; from: unknown; to: unknown }[] {
  const deltas: { field: string; from: unknown; to: unknown }[] = []
  for (const [field, val] of Object.entries(changes)) {
    if (HOUSING_KEYS.has(field) || isHousingRevisionField(field)) continue
    if (field === 'amenities') continue
    if (field === 'media_event' || field === 'listing_event') {
      deltas.push({ field, from: null, to: val })
      continue
    }
    if (val && typeof val === 'object' && !Array.isArray(val) && ('from' in val || 'to' in val)) {
      const o = val as { from?: unknown; to?: unknown }
      if (!valuesEqual(field, o.from, o.to)) {
        deltas.push({ field, from: o.from, to: o.to })
      }
    }
  }
  if (changes.amenities) {
    const amenityLines = amenityDiffLines(
      (changes.amenities as { from?: unknown }).from,
      (changes.amenities as { to?: unknown }).to,
    )
    if (amenityLines.length) {
      deltas.push({ field: 'amenities', from: null, to: amenityLines })
    }
  }
  return deltas
}

export function formatRevisionDeltaLine(field: string, from: unknown, to: unknown): string | null {
  if (field === 'media_event') {
    const toObj = (to as Record<string, unknown> | null)?.to ?? to
    const o = toObj as Record<string, unknown> | null
    if (o?.action === 'added') return 'Image: Added 1 image'
    if (o?.action === 'removed') return 'Image: Removed 1 image'
    if (o?.action === 'primary_changed' || o?.action === 'set_primary') {
      return 'Primary image: Updated'
    }
    if (o?.action === 'reordered') return 'Gallery: Reordered'
    return 'Image: Updated'
  }
  if (field === 'amenities' && Array.isArray(to)) {
    return (to as string[]).join('\n')
  }
  const fromDisp = displayOrEmpty(field, from)
  const toDisp = displayOrEmpty(field, to)
  if (!isMeaningfulChange(fromDisp, toDisp)) return null
  const label = revisionFieldLabel(field)
  if (isRawJsonDiffText(fromDisp) || isRawJsonDiffText(toDisp)) {
    return `${label} updated`
  }
  return `${label}: ${fromDisp || '—'} → ${toDisp || '—'}`
}

export function humanReadableRevisionLines(rev: ListingRevision): string[] {
  const ch = rev.changes
  if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return []
  const obj =
    typeof ch === 'string'
      ? (() => {
          try {
            return JSON.parse(ch) as Record<string, unknown>
          } catch {
            return {}
          }
        })()
      : ch
  const deltas = parseRevisionFieldDeltas(obj as Record<string, unknown>)
  const lines: string[] = []
  for (const d of deltas) {
    const line = formatRevisionDeltaLine(d.field, d.from, d.to)
    if (line) {
      for (const part of line.split('\n')) {
        if (part && !isBadRevisionLine(part)) lines.push(part)
      }
    }
  }
  return lines.slice(0, 24)
}

export function isBadRevisionLine(line: string): boolean {
  if (isRawJsonDiffText(line)) return true
  if (/\bresidence_type\b/i.test(line)) return true
  if (/^\s*[\{\[]/.test(line) || /^\s*[\}\]]\s*$/.test(line)) return true
  if (/ → —$/.test(line)) {
    const labelAndFrom = line.split('→')[0] ?? ''
    const fromVal = labelAndFrom.includes(':')
      ? labelAndFrom.split(':').slice(1).join(':').trim()
      : labelAndFrom.trim()
    if (fromVal && fromVal !== '—') return true
  }
  return false
}
