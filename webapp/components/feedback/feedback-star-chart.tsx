'use client'

import * as d3 from 'd3'
import { useEffect, useRef } from 'react'

type Row = { stars: number; count: number }

type Props = {
  distribution: Row[]
  className?: string
}

export function FeedbackStarChart({ distribution, className = '' }: Props) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const width = 320
    const height = 160
    const margin = { top: 8, right: 16, bottom: 28, left: 48 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    const sorted = [...distribution].sort((a, b) => b.stars - a.stars)
    const max = d3.max(sorted, (d) => d.count) ?? 1

    d3.select(el).selectAll('*').remove()

    const svg = d3
      .select(el)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Star rating distribution')

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3.scaleLinear().domain([0, max]).range([0, innerW])
    const y = d3
      .scaleBand()
      .domain(sorted.map((d) => String(d.stars)))
      .range([0, innerH])
      .padding(0.2)

    g.selectAll('rect')
      .data(sorted)
      .join('rect')
      .attr('y', (d) => y(String(d.stars)) ?? 0)
      .attr('x', 0)
      .attr('height', y.bandwidth())
      .attr('width', (d) => x(d.count))
      .attr('fill', 'var(--color-brand, #6366f1)')
      .attr('rx', 3)

    g.selectAll('text.label')
      .data(sorted)
      .join('text')
      .attr('class', 'label')
      .attr('x', -4)
      .attr('y', (d) => (y(String(d.stars)) ?? 0) + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', 11)
      .text((d) => `${d.stars}★`)

    g.selectAll('text.count')
      .data(sorted)
      .join('text')
      .attr('class', 'count')
      .attr('x', (d) => x(d.count) + 4)
      .attr('y', (d) => (y(String(d.stars)) ?? 0) + y.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', 10)
      .text((d) => String(d.count))
  }, [distribution])

  return (
    <figure className={className}>
      <figcaption className="sr-only">Distribution of star ratings from 5 to 1</figcaption>
      <svg ref={ref} className="w-full max-w-sm text-slate-700 dark:text-slate-200" />
    </figure>
  )
}
