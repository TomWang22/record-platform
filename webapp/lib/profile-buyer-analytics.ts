import * as d3 from 'd3'

import { apiFetch } from './api-client'
import { fetchPurchaseHistory } from './purchases-api'
import type { BarDatum, BuyerAnalyticsSummary, BuyerPurchaseRow } from './profile-analytics-types'
import { formatDate, formatMoneyCents, purchaseTypeLabel } from './records-format'
import type { CollectionRecord } from './records-types'

export type BuyerAnalyticsBundle = {
  summary: BuyerAnalyticsSummary
  rows: BuyerPurchaseRow[]
  purchasesOverTime: BarDatum[]
  spendOverTime: BarDatum[]
  purchaseTypeChart: BarDatum[]
  artistChart: BarDatum[]
  formatChart: BarDatum[]
}

function normalizePurchaseType(value?: string | null): string {
  const v = String(value ?? '').toLowerCase()
  if (v === 'negotiated_obo' || v === 'obo' || v === 'best_offer') return 'best_offer'
  if (v === 'fixed' || v === 'fixed_price') return 'fixed_price'
  if (v === 'auction' || v === 'auction_win') return 'auction_win'
  return v || 'other'
}

function purchaseTypeChartLabel(value: string): string {
  if (value === 'best_offer') return 'Best offer'
  if (value === 'fixed_price') return 'Fixed price'
  if (value === 'auction_win') return 'Auction win'
  return purchaseTypeLabel(value)
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  })
}

function recordToRow(r: CollectionRecord): BuyerPurchaseRow | null {
  if (!r.purchasedAt && !r.purchaseType) return null
  const type = normalizePurchaseType(r.purchaseType)
  const priceCents = Number(r.purchasePriceCents ?? 0)
  const href = r.listingId ? `/listings/${r.listingId}` : `/records/${r.id}`
  return {
    id: r.id,
    title: r.name,
    artist: r.artist,
    format: r.format,
    purchaseType: type,
    purchaseTypeLabel: purchaseTypeChartLabel(type),
    priceCents,
    priceDisplay: formatMoneyCents(priceCents, r.purchaseCurrency ?? 'USD'),
    purchasedAt: r.purchasedAt ?? null,
    receivedAt: r.receivedAt ?? null,
    listingId: r.listingId ?? null,
    recordId: r.id,
    href,
  }
}

export function filterBuyerRows(
  rows: BuyerPurchaseRow[],
  opts: { purchasedFrom?: string; purchasedTo?: string; receivedFrom?: string; receivedTo?: string },
): BuyerPurchaseRow[] {
  return rows.filter((row) => {
    if (opts.purchasedFrom && row.purchasedAt && row.purchasedAt < opts.purchasedFrom) return false
    if (opts.purchasedTo && row.purchasedAt && row.purchasedAt > `${opts.purchasedTo}T23:59:59Z`) {
      return false
    }
    if (opts.receivedFrom && row.receivedAt && row.receivedAt < opts.receivedFrom) return false
    if (opts.receivedTo && row.receivedAt && row.receivedAt > `${opts.receivedTo}T23:59:59Z`) {
      return false
    }
    return true
  })
}

function buildCharts(rows: BuyerPurchaseRow[]): Pick<
  BuyerAnalyticsBundle,
  'purchasesOverTime' | 'spendOverTime' | 'purchaseTypeChart' | 'artistChart' | 'formatChart'
> {
  const withDate = rows.filter((r) => r.purchasedAt)
  const purchasesOverTime = [...d3.rollup(
    withDate,
    (v) => v.length,
    (r) => r.purchasedAt!.slice(0, 7),
  )]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([label, value]) => ({ label: formatMonthLabel(label), value }))

  const spendOverTime = [...d3.rollup(
    withDate,
    (v) => d3.sum(v, (r) => r.priceCents),
    (r) => r.purchasedAt!.slice(0, 7),
  )]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([label, value]) => ({
      label: formatMonthLabel(label),
      value: Math.round(value / 100),
    }))

  const purchaseTypeChart = [...d3.rollup(rows, (v) => v.length, (r) => r.purchaseType)]
    .map(([label, value]) => ({ label: purchaseTypeChartLabel(label), value }))
    .sort((a, b) => b.value - a.value)

  const artistSorted = [...d3.rollup(rows, (v) => v.length, (r) => r.artist)].sort(
    (a, b) => b[1] - a[1],
  )
  const artistChart = artistSorted.slice(0, 5).map(([label, value]) => ({
    label: label.length > 12 ? `${label.slice(0, 11)}…` : label,
    value,
  }))
  const restArtists = d3.sum(artistSorted.slice(5), ([, v]) => v)
  if (restArtists > 0) artistChart.push({ label: 'Other', value: restArtists })

  const formatChart = [...d3.rollup(rows, (v) => v.length, (r) => r.format || 'Unknown')]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  return { purchasesOverTime, spendOverTime, purchaseTypeChart, artistChart, formatChart }
}

export async function fetchBuyerAnalytics(): Promise<BuyerAnalyticsBundle> {
  const [records, history] = await Promise.all([
    apiFetch<CollectionRecord[]>('/api/records', { auth: true }).catch(() => []),
    fetchPurchaseHistory().catch(() => ({ items: [], total: 0 })),
  ])

  const recordRows = records.map(recordToRow).filter((r): r is BuyerPurchaseRow => r != null)

  const historyRows: BuyerPurchaseRow[] = history.items.map((item) => {
    const meta = (item.metadata ?? {}) as Record<string, unknown>
    const priceCents = Math.round(Number(item.price_paid) * 100)
    const type = normalizePurchaseType(item.purchase_type)
    const listingId = item.listing_id ? String(item.listing_id) : null
    return {
      id: String(item.id),
      title: String(meta.title ?? meta.listing_title ?? `Order ${item.order_id}`),
      artist: String(meta.artist ?? '—'),
      format: String(meta.format ?? '—'),
      purchaseType: type,
      purchaseTypeLabel: purchaseTypeChartLabel(type),
      priceCents,
      priceDisplay: formatMoneyCents(priceCents, item.currency),
      purchasedAt: item.purchased_at,
      receivedAt: (meta.received_at as string | undefined) ?? null,
      listingId,
      recordId: null,
      href: listingId ? `/listings/${listingId}` : '/profile/purchases',
    }
  })

  const merged = new Map<string, BuyerPurchaseRow>()
  for (const row of [...recordRows, ...historyRows]) {
    const key = row.recordId ?? `${row.purchasedAt}:${row.title}:${row.priceCents}`
    if (!merged.has(key)) merged.set(key, row)
  }
  const rows = [...merged.values()].sort((a, b) =>
    String(b.purchasedAt ?? '').localeCompare(String(a.purchasedAt ?? '')),
  )

  const totalSpendCents = d3.sum(rows, (r) => r.priceCents)
  const artists = new Set(rows.map((r) => r.artist).filter(Boolean))
  const formats = [...d3.rollup(rows, (v) => v.length, (r) => r.format)]
  const topFormat = formats.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  return {
    summary: {
      totalPurchases: rows.length,
      totalSpendCents,
      totalSpendDisplay: formatMoneyCents(totalSpendCents),
      uniqueArtists: artists.size,
      topFormat,
    },
    rows,
    ...buildCharts(rows),
  }
}

export function buyerRowDateDisplay(row: BuyerPurchaseRow): string {
  const purchased = formatDate(row.purchasedAt)
  const received = formatDate(row.receivedAt)
  if (received !== '—') return `Received ${received}`
  return `Purchased ${purchased}`
}
