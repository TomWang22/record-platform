'use client'

import * as d3 from 'd3'
import { useEffect, useRef } from 'react'

import type { CollectionRecord } from '@/lib/records-types'

type Props = {
  records: CollectionRecord[]
}

function useBarChart(
  ref: React.RefObject<HTMLDivElement | null>,
  data: { label: string; value: number }[],
  testId: string,
) {
  useEffect(() => {
    const el = ref.current
    if (!el || data.length === 0) return
    const w = el.clientWidth || 320
    const h = 160
    const margin = { top: 8, right: 8, bottom: 28, left: 36 }
    const innerW = w - margin.left - margin.right
    const innerH = h - margin.top - margin.bottom
    d3.select(el).selectAll('*').remove()
    const svg = d3
      .select(el)
      .append('svg')
      .attr('width', w)
      .attr('height', h)
      .attr('data-testid', testId)
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, innerW])
      .padding(0.2)
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value) ?? 1])
      .nice()
      .range([innerH, 0])
    g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).tickSize(0))
    g.selectAll('text').attr('font-size', '9px')
    g.append('g').call(d3.axisLeft(y).ticks(4))
    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.label) ?? 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.value))
      .attr('fill', 'var(--color-brand, #6366f1)')
      .attr('rx', 3)
  }, [ref, data, testId])
}

export function CollectionStatsCharts({ records }: Props) {
  const acquisitionRef = useRef<HTMLDivElement>(null)
  const spendRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)
  const artistRef = useRef<HTMLDivElement>(null)

  const byMonth = d3.rollup(
    records.filter((r) => r.purchasedAt),
    (v) => v.length,
    (r) => r.purchasedAt!.slice(0, 7),
  )
  const acquisitionData = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([label, value]) => ({ label, value }))

  const spendByMonth = d3.rollup(
    records.filter((r) => r.purchasedAt),
    (v) => d3.sum(v, (r) => (r.purchasePriceCents ?? 0) / 100),
    (r) => r.purchasedAt!.slice(0, 7),
  )
  const spendData = [...spendByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([label, value]) => ({ label, value: Math.round(value) }))

  const typeData = [...d3.rollup(records, (v) => v.length, (r) => r.purchaseType ?? 'unknown')].map(
    ([label, value]) => ({ label, value }),
  )

  const artistData = [...d3.rollup(records, (v) => v.length, (r) => r.artist)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }))

  useBarChart(acquisitionRef, acquisitionData, 'collection-chart-acquisition')
  useBarChart(spendRef, spendData, 'collection-chart-spend')
  useBarChart(typeRef, typeData, 'collection-chart-type')
  useBarChart(artistRef, artistData, 'collection-chart-artist')

  if (records.length === 0) {
    return (
      <div className="space-y-2" data-testid="collection-stats-d3-ready">
        <p className="text-sm text-slate-500">Add records to see charts.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="collection-stats-d3-ready">
      <div>
        <p className="mb-2 text-sm font-semibold">Acquisition frequency</p>
        <div ref={acquisitionRef} className="min-h-[160px] w-full" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Spend over time (USD)</p>
        <div ref={spendRef} className="min-h-[160px] w-full" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Acquisition type breakdown</p>
        <div ref={typeRef} className="min-h-[160px] w-full" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Artist frequency</p>
        <div ref={artistRef} className="min-h-[160px] w-full" />
      </div>
    </div>
  )
}
