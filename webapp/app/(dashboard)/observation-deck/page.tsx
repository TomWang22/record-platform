'use client'

import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'
import dynamic from 'next/dynamic'

type PgbenchRow = { db: string; tps?: number | null; latency_ms?: number | null; latency_stddev_ms?: number | null; transactions?: number | null }
type ProtocolComparison = {
  generated_at?: string
  duration?: string
  vus?: number
  http2?: { tps?: number | null; p95_ms?: number | null; p99_ms?: number | null }
  http3?: { tps?: number | null; p95_ms?: number | null; p99_ms?: number | null }
  logs?: { http2?: string; http3?: string }
}
type ObservationDeckData = {
  generated_at?: string | null
  preflight_summary_md?: string | null
  pgbench?: PgbenchRow[]
  explain_dir?: string | null
  suite_log_dir?: string | null
  k6_logs?: string[]
  protocol_comparison?: ProtocolComparison | null
  observation_deck_summary?: string | null
}

const D3Charts = dynamic(() => import('./D3Charts'), { ssr: false })
const D3K6ProtocolChart = dynamic(() => import('./D3K6ProtocolChart'), { ssr: false })

export default function ObservationDeckPage() {
  const [data, setData] = useState<ObservationDeckData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [useGraphQL, setUseGraphQL] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        if (useGraphQL) {
          const res = await fetch('/api/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: `
                query {
                  observationDeckData {
                    generated_at
                    preflight_summary_md
                    pgbench { db tps latency_ms latency_stddev_ms transactions }
                    explain_dir
                    suite_log_dir
                    k6_logs
                    protocol_comparison { generated_at duration http2 { tps p95_ms } http3 { tps p95_ms } logs { http2 http3 } }
                    observation_deck_summary
                  }
                }
              `,
            }),
          })
          const json = await res.json()
          if (json.errors?.length) {
            setError(json.errors[0].message)
            setData(null)
          } else {
            setData(json.data?.observationDeckData ?? null)
            setError(null)
          }
        } else {
          const res = await fetch('/api/observation-deck/data')
          const json = await res.json()
          if (!res.ok) {
            setError(json.error || res.statusText)
            setData(null)
          } else {
            setData(json)
            setError(null)
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [useGraphQL])

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Observation deck</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useGraphQL}
            onChange={(e) => setUseGraphQL(e.target.checked)}
          />
          Use GraphQL API
        </label>
      </div>
      <p className="text-muted-foreground">
        k6, pgbench, latency and observability stack (Istio, Splunk, Grafana, Prometheus, New Relic, Linkerd, Jaeger, OpenTelemetry). Data from <code>bench_logs/preflight-results.json</code> after running full preflight.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p className="text-destructive">{error}</p>}

      {data && (
        <>
          {data.generated_at && (
            <p className="text-sm text-muted-foreground">Generated: {data.generated_at}</p>
          )}

          {data.pgbench && data.pgbench.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-4 text-lg font-semibold">pgbench — TPS & latency (D3.js)</h2>
              <D3Charts pgbench={data.pgbench} />
            </Card>
          )}

          {data.protocol_comparison && typeof data.protocol_comparison === 'object' && (
            <Card className="p-4">
              <h2 className="mb-2 text-lg font-semibold">k6 protocol comparison (HTTP/2 vs HTTP/3)</h2>
              <p className="mb-3 text-sm text-muted-foreground">Latency (p95, p99) and throughput — knee curve: compare p99 across protocols and VUs.</p>
              <div className="grid gap-4 sm:grid-cols-2 text-sm">
                <div className="rounded bg-muted p-3">
                  <span className="font-medium">HTTP/2</span>
                  <p className="mt-1 text-muted-foreground">TPS: {data.protocol_comparison.http2?.tps ?? '—'}</p>
                  <p className="text-muted-foreground">p95: {data.protocol_comparison.http2?.p95_ms != null ? `${data.protocol_comparison.http2.p95_ms} ms` : '—'} · p99: {data.protocol_comparison.http2?.p99_ms != null ? `${data.protocol_comparison.http2.p99_ms} ms` : '—'}</p>
                </div>
                <div className="rounded bg-muted p-3">
                  <span className="font-medium">HTTP/3 (xk6-http3)</span>
                  <p className="mt-1 text-muted-foreground">TPS: {data.protocol_comparison.http3?.tps ?? '—'}</p>
                  <p className="text-muted-foreground">p95: {data.protocol_comparison.http3?.p95_ms != null ? `${data.protocol_comparison.http3.p95_ms} ms` : '—'} · p99: {data.protocol_comparison.http3?.p99_ms != null ? `${data.protocol_comparison.http3.p99_ms} ms` : '—'}</p>
                </div>
              </div>
              {(data.protocol_comparison.duration || data.protocol_comparison.vus != null) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Duration: {data.protocol_comparison.duration ?? '—'}
                  {data.protocol_comparison.vus != null && ` · VUs: ${data.protocol_comparison.vus}`}
                </p>
              )}
              <D3K6ProtocolChart protocolComparison={data.protocol_comparison} />
            </Card>
          )}

          {data.observation_deck_summary && (
            <Card className="p-4">
              <h2 className="mb-2 text-lg font-semibold">Observation deck status</h2>
              <p className="mb-2 text-sm text-muted-foreground">Sidecars and stack (Istio, Grafana, Prometheus, Jaeger, OpenTelemetry, Linkerd, Splunk, New Relic)</p>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">{data.observation_deck_summary}</pre>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data.k6_logs && data.k6_logs.length > 0 && (
              <Card className="p-4">
                <h2 className="mb-2 text-lg font-semibold">k6 phase logs</h2>
                <ul className="list-inside list-disc text-sm">
                  {data.k6_logs.map((log) => (
                    <li key={log}>{log}</li>
                  ))}
                </ul>
                {data.suite_log_dir && <p className="mt-2 text-xs text-muted-foreground">Dir: {data.suite_log_dir}</p>}
              </Card>
            )}
            {data.explain_dir && (
              <Card className="p-4">
                <h2 className="mb-2 text-lg font-semibold">EXPLAIN (ANALYZE) output</h2>
                <p className="text-sm">All DBs/schemas: <code className="rounded bg-muted px-1">{data.explain_dir}</code></p>
              </Card>
            )}
          </div>
        </>
      )}

      {!loading && !error && data && (!data.pgbench || data.pgbench.length === 0) && !data.observation_deck_summary && (
        <Card className="p-4">
          <p className="text-muted-foreground">
            No preflight data yet. Run full preflight to populate:
          </p>
          <pre className="mt-2 rounded bg-muted p-3 text-sm">
            COLIMA_START=1 RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 PGBENCH_PARALLEL=1 ./scripts/run-preflight-scale-and-all-suites.sh
          </pre>
        </Card>
      )}
    </div>
  )
}
