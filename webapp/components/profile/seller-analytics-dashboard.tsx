'use client'

import Link from 'next/link'
import { useMemo, useRef } from 'react'

import { FeedbackStarChart } from '@/components/feedback/feedback-star-chart'
import {
  ProfileD3BarChart,
  formatCurrencyUsd,
} from '@/components/profile/profile-d3-bar-chart'
import { Card } from '@/components/ui/card'
import type { SellerAnalyticsBundle } from '@/lib/profile-seller-analytics'
import type { MarketplaceListing } from '@/lib/listings-types'

type Props = {
  data: SellerAnalyticsBundle
  statusTab?: 'active' | 'sold' | 'all'
}

function filterListings(
  listings: MarketplaceListing[],
  tab: 'active' | 'sold' | 'all',
): MarketplaceListing[] {
  if (tab === 'all') return listings
  if (tab === 'active') {
    return listings.filter((l) => {
      const s = String(l.status ?? '').toLowerCase()
      return s === 'active' || s === 'published' || s === 'draft'
    })
  }
  return listings.filter((l) => {
    const s = String(l.status ?? '').toLowerCase()
    return s === 'sold' || s === 'archived' || s === 'closed'
  })
}

export function SellerAnalyticsDashboard({ data, statusTab = 'all' }: Props) {
  const salesRef = useRef<HTMLDivElement>(null)
  const revenueRef = useRef<HTMLDivElement>(null)
  const oboRef = useRef<HTMLDivElement>(null)
  const auctionRef = useRef<HTMLDivElement>(null)

  const visibleListings = useMemo(
    () => filterListings(data.listings, statusTab),
    [data.listings, statusTab],
  )

  const hasAnyData =
    data.summary.activeListings > 0 ||
    data.summary.soldListings > 0 ||
    data.oboStatusChart.length > 0 ||
    data.auctionOutcomeChart.length > 0

  if (!hasAnyData) {
    return (
      <div className="space-y-4" data-testid="seller-analytics-empty-state">
        <Card>
          <p className="text-sm text-slate-500">
            No seller activity yet. Create a listing to start tracking sales, offers, and auctions.
          </p>
        </Card>
        <Link href="/sell" className="text-sm text-brand">
          Create listing →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="seller-analytics-ready">
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="seller-analytics-summary"
      >
        {[
          { label: 'Active listings', value: data.summary.activeListings },
          { label: 'Sold listings', value: data.summary.soldListings },
          { label: 'Revenue', value: data.summary.revenueDisplay },
          { label: 'Avg sale price', value: data.summary.avgSalePriceDisplay },
          { label: 'Avg days to sold', value: data.summary.avgDaysToSold ?? '—' },
          { label: 'OBO accept rate', value: data.summary.oboAcceptRateDisplay },
          { label: 'Auctions won/sold', value: data.summary.auctionWon },
          { label: 'Auctions ended unsold', value: data.summary.auctionLost },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{item.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2" data-testid="seller-analytics-d3-ready">
        <ProfileD3BarChart
          title="Sales over time"
          data={data.salesOverTime}
          testId="seller-chart-sales"
          chartRef={salesRef}
          rotateLabels
          emptyMessage="No sold listings in the selected window."
        />
        <ProfileD3BarChart
          title="Revenue over time"
          data={data.revenueOverTime}
          testId="seller-chart-revenue"
          chartRef={revenueRef}
          formatValue={formatCurrencyUsd}
          rotateLabels
          emptyMessage="No revenue recorded yet."
        />
        <ProfileD3BarChart
          title="OBO status distribution"
          data={data.oboStatusChart}
          testId="seller-chart-obo"
          chartRef={oboRef}
          emptyMessage="No offers received on your listings yet."
        />
        <ProfileD3BarChart
          title="Auction outcomes"
          data={data.auctionOutcomeChart}
          testId="seller-chart-auction"
          chartRef={auctionRef}
          emptyMessage="No auction listings yet."
        />
      </div>

      {data.feedbackDistribution.some((d) => d.count > 0) ? (
        <Card className="p-4" data-testid="seller-feedback-chart-section">
          <h2 className="mb-4 font-semibold">Feedback star distribution</h2>
          <div data-testid="seller-feedback-chart">
            <FeedbackStarChart distribution={data.feedbackDistribution} />
          </div>
        </Card>
      ) : null}

      <section>
        <h2 className="mb-3 font-semibold">Listings</h2>
        <div className="space-y-2" data-testid="seller-listings-table">
          {visibleListings.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-500">No listings in this tab.</p>
            </Card>
          ) : (
            visibleListings.map((l) => (
              <Card key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={`/listings/${l.id}`} className="font-medium text-brand hover:underline">
                    {l.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {l.status ?? l.listing_status ?? 'active'} · {l.priceDisplay ?? '—'}
                  </p>
                </div>
                <span className="text-xs uppercase text-slate-400">{l.saleType ?? l.pricing_mode ?? 'fixed'}</span>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
