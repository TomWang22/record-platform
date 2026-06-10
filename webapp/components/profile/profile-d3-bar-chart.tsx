'use client'

import * as d3 from 'd3'
import { useEffect } from 'react'

import type { BarDatum } from '@/lib/profile-analytics-types'

import { Card } from '../ui/card'

type Props = {
  title: string
  data: BarDatum[]
  testId: string
  chartRef: React.RefObject<HTMLDivElement | null>
  formatValue?: (n: number) => string
  rotateLabels?: boolean
  emptyMessage?: string
}

function defaultFormat(n: number): string {
  return String(n)
}

export function formatCurrencyUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function useProfileBarChart(
  ref: React.RefObject<HTMLDivElement | null>,
  data: BarDatum[],
  testId: string,
  opts: { formatValue?: (n: number) => string; rotateLabels?: boolean } = {},
) {
  const { formatValue = defaultFormat, rotateLabels = false } = opts

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

export function ProfileD3BarChart({
  title,
  data,
  testId,
  chartRef,
  formatValue,
  rotateLabels = true,
  emptyMessage = 'No data for this period.',
}: Props) {
  useProfileBarChart(chartRef, data, testId, { formatValue, rotateLabels })

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid={`${testId}-empty`}>
          {emptyMessage}
        </p>
      ) : null}
      <div ref={chartRef} className="min-h-[220px] w-full" data-testid={testId} />
    </Card>
  )
}
