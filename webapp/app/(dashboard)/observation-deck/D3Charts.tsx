'use client'

import { useEffect, useRef } from 'react'

type PgbenchRow = { db: string; tps?: number | null; latency_ms?: number | null }

export default function D3Charts({ pgbench }: { pgbench: PgbenchRow[] }) {
  const tpsRef = useRef<HTMLDivElement>(null)
  const latencyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pgbench.length) return
    const load = async () => {
      const d3 = await import('d3')
      const data = pgbench.filter((r) => r.db)

      const margin = { top: 20, right: 20, bottom: 60, left: 50 }
      const width = 400 - margin.left - margin.right
      const height = 220 - margin.top - margin.bottom

      const drawBar = (
        container: HTMLDivElement,
        key: 'tps' | 'latency_ms',
        label: string,
        format: (n: number) => string
      ) => {
        d3.select(container).selectAll('*').remove()
        const values = data.map((d) => Number((d as Record<string, unknown>)[key]) || 0).filter((v) => v > 0)
        if (!values.length) {
          container.innerHTML = `<p class="text-sm text-muted-foreground">No ${label} data</p>`
          return
        }
        const svg = d3
          .select(container)
          .append('svg')
          .attr('width', width + margin.left + margin.right)
          .attr('height', height + margin.top + margin.bottom)
          .append('g')
          .attr('transform', `translate(${margin.left},${margin.top})`)
        const x = d3
          .scaleBand()
          .domain(data.map((d) => d.db))
          .range([0, width])
          .padding(0.2)
        const y = d3
          .scaleLinear()
          .domain([0, Math.max(...values) * 1.1 || 1])
          .range([height, 0])
        svg
          .append('g')
          .attr('transform', `translate(0,${height})`)
          .call(d3.axisBottom(x))
          .selectAll('text')
          .attr('transform', 'rotate(-35)')
          .style('text-anchor', 'end')
        svg.append('g').call(d3.axisLeft(y))
        svg
          .selectAll('rect')
          .data(data)
          .join('rect')
          .attr('x', (d) => x(d.db) ?? 0)
          .attr('y', (d) => {
            const v = Number((d as Record<string, unknown>)[key]) || 0
            return y(v)
          })
          .attr('width', x.bandwidth())
          .attr('height', (d) => {
            const v = Number((d as Record<string, unknown>)[key]) || 0
            return height - y(v)
          })
          .attr('fill', 'hsl(var(--primary))')
      }

      if (tpsRef.current) drawBar(tpsRef.current, 'tps', 'TPS', (n) => n.toFixed(1))
      if (latencyRef.current) drawBar(latencyRef.current, 'latency_ms', 'Latency (ms)', (n) => `${n.toFixed(1)} ms`)
    }
    load()
  }, [pgbench])

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium">TPS by DB</h3>
        <div ref={tpsRef} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">Latency (ms) by DB</h3>
        <div ref={latencyRef} />
      </div>
    </div>
  )
}
