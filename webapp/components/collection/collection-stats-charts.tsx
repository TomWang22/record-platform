'use client'

import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'

import { purchaseTypeLabel } from '@/lib/records-format'
import type { CollectionRecord } from '@/lib/records-types'

import { Card } from '../ui/card'

type Props = {
  records: CollectionRecord[]
}

type BarDatum = { label: string; value: number }

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

function truncateLabel(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function useBarChart(
  ref: React.RefObject<HTMLDivElement | null>,
  data: BarDatum[],
  testId: string,
  opts: { formatValue?: (n: number) => string; rotateLabels?: boolean } = {},
) {
  const { formatValue = (n) => String(n), rotateLabels = false } = opts

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.setAttribute('data-testid', testId)
    if (data.length === 0) {
      el.setAttribute('data-chart-rendered', 'empty')
      d3.select(el).selectAll('*').remove()
      return
    }

    const w = el.clientWidth || 360
    const h = 220
    const margin = { top: 20, right: 12, bottom: rotateLabels ? 52 : 36, left: 48 }
    const innerW = w - margin.left - margin.right
    const innerH = h - margin.top - margin.bottom

    d3.select(el).selectAll('*').remove()
    el.setAttribute('data-chart-rendered', 'false')

    const svg = d3.select(el).append('svg').attr('width', w).attr('height', h)
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, innerW])
      .padding(0.25)

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value) ?? 1])
      .nice()
      .range([innerH, 0])

    const xAxis = g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).tickSize(0))
    xAxis.selectAll('text').attr('font-size', '10px').attr('fill', '#64748b')
    if (rotateLabels) {
      xAxis
        .selectAll('text')
        .attr('transform', 'rotate(-35)')
        .style('text-anchor', 'end')
        .attr('dx', '-0.4em')
        .attr('dy', '0.15em')
    }

    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat((d) => formatValue(Number(d))))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#64748b')

    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.label) ?? 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.value))
      .attr('fill', 'var(--color-brand, #6366f1)')
      .attr('rx', 4)

    g.selectAll('text.bar-label')
      .data(data)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.value) - 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#334155')
      .text((d) => (d.value > 0 ? formatValue(d.value) : ''))

    el.setAttribute('data-chart-rendered', 'true')
  }, [ref, data, testId, formatValue, rotateLabels])
}

function CollectionStatsSummary({ records }: { records: CollectionRecord[] }) {
  const summary = useMemo(() => {
    const artists = d3.rollup(records, (v) => v.length, (r) => r.artist)
    const topArtist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]
    const types = d3.rollup(records, (v) => v.length, (r) => r.purchaseType ?? 'unknown')
    const topType = [...types.entries()].sort((a, b) => b[1] - a[1])[0]
    const spend = d3.sum(records, (r) => (r.purchasePriceCents ?? 0) / 100)
    return {
      totalRecords: records.length,
      totalSpend:
        spend > 0
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(spend)
          : '—',
      topArtist: topArtist ? `${truncateLabel(topArtist[0], 18)} (${topArtist[1]})` : '—',
      topType: topType ? purchaseTypeLabel(topType[0]) : '—',
    }
  }, [records])

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="collection-stats-summary"
    >
      {[
        { label: 'Total records', value: summary.totalRecords },
        { label: 'Total spend', value: summary.totalSpend },
        { label: 'Top artist', value: summary.topArtist },
        { label: 'Most common type', value: summary.topType },
      ].map((item) => (
        <Card key={item.label} className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{item.value}</p>
        </Card>
      ))}
    </div>
  )
}

export function CollectionStatsCharts({ records }: Props) {
  const acquisitionRef = useRef<HTMLDivElement>(null)
  const spendRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const artistRef = useRef<HTMLDivElement>(null)

  const acquisitionData = useMemo(() => {
    const byMonth = d3.rollup(
      records.filter((r) => r.purchasedAt),
      (v) => v.length,
      (r) => r.purchasedAt!.slice(0, 7),
    )
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([label, value]) => ({ label: formatMonthLabel(label), value }))
  }, [records])

  const spendData = useMemo(() => {
    const spendByMonth = d3.rollup(
      records.filter((r) => r.purchasedAt),
      (v) => d3.sum(v, (r) => (r.purchasePriceCents ?? 0) / 100),
      (r) => r.purchasedAt!.slice(0, 7),
    )
    return [...spendByMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([label, value]) => ({ label: formatMonthLabel(label), value: Math.round(value) }))
  }, [records])

  const typeData = useMemo(
    () =>
      [...d3.rollup(records, (v) => v.length, (r) => r.purchaseType ?? 'unknown')]
        .map(([label, value]) => ({ label: purchaseTypeLabel(label), value }))
        .sort((a, b) => b.value - a.value),
    [records],
  )

  const artistData = useMemo(() => {
    const sorted = [...d3.rollup(records, (v) => v.length, (r) => r.artist)].sort(
      (a, b) => b[1] - a[1],
    )
    const top = sorted.slice(0, 5).map(([label, value]) => ({
      label: truncateLabel(label, 12),
      value,
    }))
    const rest = d3.sum(sorted.slice(5), ([, v]) => v)
    if (rest > 0) top.push({ label: 'Other', value: rest })
    return top
  }, [records])

  useBarChart(acquisitionRef, acquisitionData, 'collection-chart-acquisition', { rotateLabels: true })
  useBarChart(spendRef, spendData, 'collection-chart-spend', {
    formatValue: formatCurrency,
    rotateLabels: true,
  })
  useBarChart(typeRef, typeData, 'collection-chart-type', { rotateLabels: true })
  useBarChart(artistRef, artistData, 'collection-chart-artist', { rotateLabels: true })

  if (records.length === 0) {
    return (
      <div className="space-y-2" data-testid="collection-stats-d3-ready">
        <p className="text-sm text-slate-500">Add records to see charts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CollectionStatsSummary records={records} />
      <div className="grid gap-6 lg:grid-cols-2" data-testid="collection-stats-d3-ready">
        {[
          { title: 'Acquisition frequency', ref: acquisitionRef, testId: 'collection-chart-acquisition' },
          { title: 'Spend over time', ref: spendRef, testId: 'collection-chart-spend' },
          { title: 'Acquisition type', ref: typeRef, testId: 'collection-chart-type' },
          { title: 'Top artists', ref: artistRef, testId: 'collection-chart-artist' },
        ].map((chart) => (
          <Card key={chart.testId} className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{chart.title}</p>
            <div
              ref={chart.ref}
              className="min-h-[220px] w-full"
              data-testid={chart.testId}
            />
          </Card>
        ))}
      </div>
    </div>
  )
}
