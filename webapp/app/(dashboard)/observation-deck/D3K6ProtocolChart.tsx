'use client'

import { useEffect, useRef } from 'react'

type ProtocolComparison = {
  http2?: { tps?: number | null; p95_ms?: number | null; p99_ms?: number | null }
  http3?: { tps?: number | null; p95_ms?: number | null; p99_ms?: number | null }
}

export default function D3K6ProtocolChart({ protocolComparison }: { protocolComparison: ProtocolComparison }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!protocolComparison || !containerRef.current) return
    const h2 = protocolComparison.http2
    const h3 = protocolComparison.http3
    const hasP95 = (h2?.p95_ms != null && h2.p95_ms > 0) || (h3?.p95_ms != null && h3.p95_ms > 0)
    const hasP99 = (h2?.p99_ms != null && h2.p99_ms > 0) || (h3?.p99_ms != null && h3.p99_ms > 0)
    if (!hasP95 && !hasP99) return

    const load = async () => {
      const d3 = await import('d3')
      d3.select(containerRef.current).selectAll('*').remove()
      const margin = { top: 16, right: 20, bottom: 50, left: 42 }
      const width = 360 - margin.left - margin.right
      const height = 160 - margin.top - margin.bottom

      const protocols = ['HTTP/2', 'HTTP/3']
      const data = [
        { protocol: 'HTTP/2', p95: Number(h2?.p95_ms) || 0, p99: Number(h2?.p99_ms) || 0 },
        { protocol: 'HTTP/3', p95: Number(h3?.p95_ms) || 0, p99: Number(h3?.p99_ms) || 0 },
      ].filter((d) => d.p95 > 0 || d.p99 > 0)
      if (!data.length) return

      const svg = d3
        .select(containerRef.current)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

      const x = d3.scaleBand().domain(protocols).range([0, width]).padding(0.35)
      const maxVal = Math.max(...data.flatMap((d) => [d.p95, d.p99]).filter((v) => v > 0), 1)
      const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0])

      svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x))
      svg.append('g').call(d3.axisLeft(y).tickFormat((n) => `${n}ms`))

      if (hasP95) {
        svg
          .selectAll('.bar-p95')
          .data(data)
          .join('rect')
          .attr('class', 'bar-p95')
          .attr('x', (d) => (x(d.protocol) ?? 0) + (x.bandwidth() ?? 0) * 0.1)
          .attr('y', (d) => y(d.p95))
          .attr('width', (x.bandwidth() ?? 0) * 0.35)
          .attr('height', (d) => height - y(d.p95))
          .attr('fill', 'hsl(220 70% 50%)')
      }
      if (hasP99) {
        svg
          .selectAll('.bar-p99')
          .data(data)
          .join('rect')
          .attr('class', 'bar-p99')
          .attr('x', (d) => (x(d.protocol) ?? 0) + (x.bandwidth() ?? 0) * 0.55)
          .attr('y', (d) => y(d.p99))
          .attr('width', (x.bandwidth() ?? 0) * 0.35)
          .attr('height', (d) => height - y(d.p99))
          .attr('fill', 'hsl(280 60% 50%)')
      }

      const legend = svg.append('g').attr('transform', `translate(0,${height + 24})`)
      if (hasP95) legend.append('rect').attr('x', 0).attr('y', 0).attr('width', 12).attr('height', 12).attr('fill', 'hsl(220 70% 50%)')
      if (hasP95) legend.append('text').attr('x', 16).attr('y', 10).attr('font-size', 11).text('p95')
      if (hasP99) legend.append('rect').attr('x', 60).attr('y', 0).attr('width', 12).attr('height', 12).attr('fill', 'hsl(280 60% 50%)')
      if (hasP99) legend.append('text').attr('x', 76).attr('y', 10).attr('font-size', 11).text('p99')
    }
    load()
  }, [protocolComparison])

  return <div ref={containerRef} className="mt-3 min-h-[180px]" />
}
