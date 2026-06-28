import fs from 'node:fs'
import path from 'node:path'

export type SellerPanelLatency = {
  panel_id: string
  panel_name: string
  endpoint_path: string
  http_status: number
  api_ms: number
  ui_ready_ms: number
  summary_chars: number
  refs_count: number
  synthesis_template: string | null
  leakage_result: string
}

export type SellerIntelligenceSessionResult = {
  ticket: string
  baseline_sha: string
  run_timestamp: string
  base_url: string
  browser: string
  login_user: string
  command: string
  page_ready_ms: number
  seller_dashboard_ready_ms: number
  rag_ready_ms: number | null
  panels: SellerPanelLatency[]
  aggregate: {
    panels: number
    panels_passed: number
    p50_api_ms: number
    p95_api_ms: number
    p50_ui_ready_ms: number
    p95_ui_ready_ms: number
    leakage: string
  }
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[idx] * 10) / 10
}

export function sellerIntelArtifactDir(timestamp: string): string {
  const repoRoot = path.resolve(process.cwd(), '..')
  return path.join(repoRoot, 'bench_logs', 'ai-platform', 'seller-intelligence-ui', timestamp)
}

export function buildSellerIntelAggregate(
  panels: SellerPanelLatency[],
): SellerIntelligenceSessionResult['aggregate'] {
  const apiMs = panels.map((p) => p.api_ms).filter((n) => n > 0)
  const uiMs = panels.map((p) => p.ui_ready_ms)
  const passed = panels.filter((p) => p.http_status === 200 && p.summary_chars > 20).length
  const leakage = panels.some((p) => p.leakage_result !== 'PASS') ? 'FAIL' : 'PASS'

  return {
    panels: panels.length,
    panels_passed: passed,
    p50_api_ms: percentile(apiMs, 50),
    p95_api_ms: percentile(apiMs, 95),
    p50_ui_ready_ms: percentile(uiMs, 50),
    p95_ui_ready_ms: percentile(uiMs, 95),
    leakage,
  }
}

export function writeSellerIntelArtifacts(
  session: SellerIntelligenceSessionResult,
  timestamp: string,
): { mdPath: string; jsonPath: string } {
  const dir = sellerIntelArtifactDir(timestamp)
  fs.mkdirSync(dir, { recursive: true })
  const jsonPath = path.join(dir, `${timestamp}.json`)
  const mdPath = path.join(dir, `${timestamp}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2))

  const lines = [
    '# Seller intelligence UI latency run (P21.6)',
    '',
    `Timestamp: ${timestamp}`,
    `Baseline: ${session.baseline_sha}`,
    '',
    '## Timing',
    '',
    `- page_ready_ms: ${session.page_ready_ms}`,
    `- seller_dashboard_ready_ms: ${session.seller_dashboard_ready_ms}`,
    `- rag_ready_ms: ${session.rag_ready_ms ?? 'n/a'}`,
    `- p50 API ms: ${session.aggregate.p50_api_ms}`,
    `- p95 API ms: ${session.aggregate.p95_api_ms}`,
    `- p50 UI ready ms: ${session.aggregate.p50_ui_ready_ms}`,
    `- p95 UI ready ms: ${session.aggregate.p95_ui_ready_ms}`,
    '',
    '## Panels',
    '',
  ]

  for (const p of session.panels) {
    lines.push(
      `### ${p.panel_name}`,
      '',
      `- api_ms: ${p.api_ms}`,
      `- ui_ready_ms: ${p.ui_ready_ms}`,
      `- http: ${p.http_status}`,
      `- refs: ${p.refs_count}`,
      `- template: ${p.synthesis_template ?? 'n/a'}`,
      '',
    )
  }

  fs.writeFileSync(mdPath, lines.join('\n'))
  return { mdPath, jsonPath }
}
