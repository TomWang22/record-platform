'use client'

import * as d3 from 'd3'
import Link from 'next/link'
import { useMemo, useRef } from 'react'

import {
  ProfileD3BarChart,
  formatCurrencyUsd,
} from '@/components/profile/profile-d3-bar-chart'
import { Card } from '@/components/ui/card'
import type { BarDatum } from '@/lib/profile-analytics-types'
import {
  buyerRowDateDisplay,
  filterBuyerRows,
  type BuyerAnalyticsBundle,
} from '@/lib/profile-buyer-analytics'

type Props = {
  data: BuyerAnalyticsBundle
  purchasedFrom?: string
  purchasedTo?: string
  receivedFrom?: string
  receivedTo?: string
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  })
}

function buildFilteredCharts(rows: BuyerAnalyticsBundle['rows']): {
  purchasesOverTime: BarDatum[]
  spendOverTime: BarDatum[]
  purchaseTypeChart: BarDatum[]
} {
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

  const purchaseTypeChart = [...d3.rollup(rows, (v) => v.length, (r) => r.purchaseTypeLabel)]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  return { purchasesOverTime, spendOverTime, purchaseTypeChart }
}

export function BuyerPurchasesDashboard({
  data,
  purchasedFrom,
  purchasedTo,
  receivedFrom,
  receivedTo,
}: Props) {
  const purchasesRef = useRef<HTMLDivElement>(null)
  const spendRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const artistRef = useRef<HTMLDivElement>(null)

  const filteredRows = useMemo(
    () =>
      filterBuyerRows(data.rows, {
        purchasedFrom,
        purchasedTo,
        receivedFrom,
        receivedTo,
      }),
    [data.rows, purchasedFrom, purchasedTo, receivedFrom, receivedTo],
  )

  const charts = useMemo(() => {
    const filtered = buildFilteredCharts(filteredRows)
    return {
      purchasesOverTime: filtered.purchasesOverTime,
      spendOverTime: filtered.spendOverTime,
      purchaseTypeChart: filtered.purchaseTypeChart,
      formatChart: data.formatChart,
    }
  }, [data.formatChart, filteredRows])

  if (data.rows.length === 0) {
    return (
      <div data-testid="buyer-purchases-empty-state">
        <Card>
          <p className="text-sm text-slate-500">
            No purchases recorded yet. Acquisitions from checkout, offers, and auctions appear here.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="buyer-purchases-ready">
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="buyer-purchases-summary"
      >
        {[
          { label: 'Total purchases', value: filteredRows.length },
          { label: 'Total spend', value: data.summary.totalSpendDisplay },
          { label: 'Unique artists', value: data.summary.uniqueArtists },
          { label: 'Top format', value: data.summary.topFormat },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{item.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2" data-testid="buyer-purchases-d3-ready">
        <ProfileD3BarChart
          title="Purchases over time"
          data={charts.purchasesOverTime}
          testId="buyer-chart-purchases"
          chartRef={purchasesRef}
          rotateLabels
        />
        <ProfileD3BarChart
          title="Spend over time"
          data={charts.spendOverTime}
          testId="buyer-chart-spend"
          chartRef={spendRef}
          formatValue={formatCurrencyUsd}
          rotateLabels
        />
        <ProfileD3BarChart
          title="Purchase type distribution"
          data={charts.purchaseTypeChart}
          testId="buyer-chart-purchase-type"
          chartRef={typeRef}
        />
        <ProfileD3BarChart
          title="By format"
          data={charts.formatChart}
          testId="buyer-chart-format"
          chartRef={artistRef}
        />
      </div>

      <section>
        <h2 className="mb-3 font-semibold">Acquisition history</h2>
        <div className="space-y-2" data-testid="buyer-purchases-table">
          {filteredRows.map((row) => (
            <Card key={row.id} className="p-4" data-testid="buyer-purchase-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={row.href} className="font-medium text-brand hover:underline">
                    {row.artist} — {row.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {row.purchaseTypeLabel} · {row.format} · {row.priceDisplay}
                  </p>
                  <p className="text-xs text-slate-400">{buyerRowDateDisplay(row)}</p>
                </div>
                {row.listingId ? (
                  <Link href={`/listings/${row.listingId}`} className="text-xs text-brand">
                    View listing
                  </Link>
                ) : row.recordId ? (
                  <Link href={`/records/${row.recordId}`} className="text-xs text-brand">
                    View record
                  </Link>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
