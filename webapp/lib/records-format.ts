import type { CollectionRecord } from './records-types'

const PURCHASE_TYPE_LABELS: Record<string, string> = {
  fixed_price: 'Fixed price',
  negotiated_obo: 'OBO / negotiated',
  auction_win: 'Auction win',
  trade: 'Trade',
  gift: 'Gift',
  retail: 'Retail',
  other: 'Other',
}

export function purchaseTypeLabel(value?: string | null): string {
  if (!value) return '—'
  return PURCHASE_TYPE_LABELS[value] ?? value.replace(/_/g, ' ')
}

export function formatMoneyCents(
  cents?: number | null,
  currency = 'USD',
): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(cents / 100)
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function recordSubtitle(record: CollectionRecord): string {
  const parts: string[] = [record.format]
  if (record.label) parts.push(record.label)
  if (record.catalogNumber) parts.push(record.catalogNumber)
  if (record.pressingYear) parts.push(String(record.pressingYear))
  else if (record.releaseYear) parts.push(String(record.releaseYear))
  return parts.filter(Boolean).join(' · ')
}

export function gradeSummary(record: CollectionRecord): string | null {
  const rg = record.recordGrade?.trim()
  const sg = record.sleeveGrade?.trim()
  if (rg && sg) return `${rg} / ${sg}`
  if (rg) return rg
  if (sg) return `Sleeve ${sg}`
  return null
}

export function revisionFieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

export function displayRevisionValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
