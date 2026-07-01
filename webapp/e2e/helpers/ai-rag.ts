import fs from 'node:fs'
import path from 'node:path'

import type { AiEnvelope } from './ai-contract'

export const RAG_INFERENCE_PROMPTS = [
  {
    id: 'catalog_activity',
    prompt: 'Summarize listing activity and buyer interest for my catalog.',
  },
  {
    id: 'seller_notifications',
    prompt: 'What notifications matter most for my selling activity right now?',
  },
  {
    id: 'offer_bidding_activity',
    prompt: 'Show a concise summary of bidding and offer activity tied to my recent listings.',
  },
  {
    id: 'listing_revision_changes',
    prompt: 'What changed recently on listing revisions that may affect offers?',
  },
  {
    id: 'private_negotiation_no_messages',
    prompt:
      'Summarize my private seller-side negotiation context without exposing message bodies.',
  },
  {
    id: 'seller_attention_today',
    prompt: 'What should I pay attention to as a seller today?',
  },
  {
    id: 'marketplace_activity_summary',
    prompt: 'Give me a grounded summary of recent marketplace activity relevant to me.',
  },
] as const

export const OLD_RAG_BOILERPLATE = 'Retrieved 8 grounded excerpts for your question.'

const FORBIDDEN = /demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids|off[- ]campus/i
const MESSAGE_LEAK = /message_body|thread_text|private obo message/i

export type RagUiCaseResult = {
  case_id: string
  prompt: string
  ui_url: string
  login_user: string
  submit_timestamp: string
  answer_visible_timestamp: string
  ui_total_ms: number
  network_request_ms: number
  backend_timing_ms: number | null
  http_status: number
  retrieval_mode: string
  model_used: string
  answer_text: string
  answer_visible: boolean
  answer_char_count: number
  answer_excerpt_800_chars: string
  source_types: string[]
  refs_count: number
  visible_source_excerpt: string
  response_source_excerpt: string
  synthesis_template: string | null
  leakage_result: 'PASS' | string
  error_message: string | null
  quality_score: number
  useful: 'yes' | 'partial' | 'no'
  old_boilerplate_only: boolean
}

export type RagUiSessionResult = {
  ticket: string
  baseline_sha: string
  run_timestamp: string
  base_url: string
  browser: string
  viewport: { width: number; height: number }
  login_user: string
  command: string
  cases: RagUiCaseResult[]
  aggregate: {
    cases: number
    ui_pass: number
    keyword_rule_engine: number
    avg_answer_chars: number
    p50_ui_ms: number
    p95_ui_ms: number
    p50_api_ms: number
    p95_api_ms: number
    leakage: string
    old_boilerplate_regression: boolean
  }
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[idx] * 10) / 10
}

export function leakageCheck(text: string, sourceTypes: string[]): 'PASS' | string {
  if (sourceTypes.includes('message')) return 'FAIL_message_source_type'
  if (MESSAGE_LEAK.test(text)) return 'FAIL_message_leak'
  if (FORBIDDEN.test(text)) return 'FAIL_forbidden'
  return 'PASS'
}

export function isOldBoilerplateOnly(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === OLD_RAG_BOILERPLATE || trimmed.startsWith(OLD_RAG_BOILERPLATE)
}

export function scoreAnswer(caseId: string, text: string): { score: number; useful: 'yes' | 'partial' | 'no' } {
  if (!text || text.length < 20) return { score: 0, useful: 'no' }
  if (isOldBoilerplateOnly(text)) return { score: 2, useful: 'no' }

  const hasStructure =
    /\n1\.|Recommended next step|Grounding:|Offers:|Offer activity|catalog shows|seller actions/i.test(text)
  const hasCaveat = /not ingested|limited:|No listing_revision|message bodies were not/i.test(text)

  if (caseId === 'seller_attention_today' && /Top seller actions|Refresh active listing/i.test(text)) {
    return { score: 4, useful: 'partial' }
  }
  if (hasCaveat && hasStructure) return { score: 3.5, useful: 'partial' }
  if (hasStructure && text.length > 120) return { score: 3.5, useful: 'yes' }
  if (text.length > 80) return { score: 3, useful: 'partial' }
  return { score: 2, useful: 'no' }
}

export function extractSourceTypes(envelope: AiEnvelope): string[] {
  const fromDetails = envelope.details?.source_types
  if (Array.isArray(fromDetails)) return fromDetails.map(String)
  const refs = envelope.source_refs ?? []
  return [...new Set(refs.map((r) => r.source_type).filter(Boolean))]
}

export function responseExcerpt(envelope: AiEnvelope): string {
  const excerpts = envelope.details?.excerpts
  if (Array.isArray(excerpts) && excerpts.length) {
    return String(excerpts[0]).slice(0, 220)
  }
  const first = envelope.source_refs?.[0]
  if (first) return `${first.source_type}:${first.source_id.slice(0, 8)}…`
  return ''
}

export function uiInferenceArtifactDir(timestamp: string): string {
  const repoRoot = path.resolve(process.cwd(), '..')
  return path.join(repoRoot, 'bench_logs', 'ai-platform', 'ui-inference', timestamp)
}

export function writeUiInferenceArtifacts(session: RagUiSessionResult, timestamp: string): {
  mdPath: string
  jsonPath: string
  rawDir: string
} {
  const dir = uiInferenceArtifactDir(timestamp)
  const rawDir = path.join(dir, `raw-${timestamp}`)
  fs.mkdirSync(rawDir, { recursive: true })

  const jsonPath = path.join(dir, `${timestamp}.json`)
  const mdPath = path.join(dir, `${timestamp}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2))
  for (const c of session.cases) {
    fs.writeFileSync(path.join(rawDir, `${c.case_id}.json`), JSON.stringify(c, null, 2))
  }

  const lines: string[] = [
    '# UI AI/RAG inference acceptance run',
    '',
    `Timestamp: ${timestamp}`,
    `Baseline: ${session.baseline_sha}`,
    '',
    '## Aggregate',
    '',
    `- cases: ${session.aggregate.cases}`,
    `- UI pass: ${session.aggregate.ui_pass}`,
    `- keyword/rule-engine: ${session.aggregate.keyword_rule_engine}`,
    `- avg answer chars: ${session.aggregate.avg_answer_chars}`,
    `- p50 UI ms: ${session.aggregate.p50_ui_ms}`,
    `- p95 UI ms: ${session.aggregate.p95_ui_ms}`,
    `- p50 API ms: ${session.aggregate.p50_api_ms}`,
    `- p95 API ms: ${session.aggregate.p95_api_ms}`,
    `- leakage: ${session.aggregate.leakage}`,
    `- old boilerplate regression: ${session.aggregate.old_boilerplate_regression}`,
    '',
  ]

  for (const c of session.cases) {
    lines.push(`## ${c.case_id}`, '', c.prompt, '', c.answer_text, '')
  }

  fs.writeFileSync(mdPath, lines.join('\n'))
  return { mdPath, jsonPath, rawDir }
}

const ACCEPTED_UI_RETRIEVAL_MODES = new Set([
  'keyword',
  'hybrid_canary',
  'keyword_fallback_from_hybrid',
])

function isAcceptedUiRetrievalMode(mode: string): boolean {
  return ACCEPTED_UI_RETRIEVAL_MODES.has(mode)
}

export function buildAggregate(cases: RagUiCaseResult[]): RagUiSessionResult['aggregate'] {
  const uiMs = cases.map((c) => c.ui_total_ms)
  const apiMs = cases.map((c) => c.network_request_ms)
  const chars = cases.map((c) => c.answer_char_count)
  const uiPass = cases.filter(
    (c) =>
      c.answer_visible &&
      c.http_status === 200 &&
      isAcceptedUiRetrievalMode(c.retrieval_mode) &&
      c.model_used === 'rule-engine' &&
      c.leakage_result === 'PASS' &&
      c.answer_char_count > 80 &&
      !c.old_boilerplate_only,
  ).length
  const keywordOk = cases.filter(
    (c) => isAcceptedUiRetrievalMode(c.retrieval_mode) && c.model_used === 'rule-engine',
  ).length
  const leakageFail = cases.some((c) => c.leakage_result !== 'PASS')

  return {
    cases: cases.length,
    ui_pass: uiPass,
    keyword_rule_engine: keywordOk,
    avg_answer_chars: chars.length
      ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length)
      : 0,
    p50_ui_ms: percentile(uiMs, 50),
    p95_ui_ms: percentile(uiMs, 95),
    p50_api_ms: percentile(apiMs, 50),
    p95_api_ms: percentile(apiMs, 95),
    leakage: leakageFail ? 'FAIL' : 'PASS',
    old_boilerplate_regression: cases.some((c) => c.old_boilerplate_only),
  }
}

export function printUiInferenceConsoleSummary(
  session: RagUiSessionResult,
  paths: { mdPath: string; jsonPath: string; rawDir: string },
): void {
  console.log('\nUI AI/RAG inference acceptance complete\n')
  console.log(`Report:\n  ${paths.mdPath}`)
  console.log(`JSON:\n  ${paths.jsonPath}`)
  console.log(`Raw dir:\n  ${paths.rawDir}\n`)

  session.cases.forEach((c, i) => {
    console.log(`Case ${i + 1} ${c.case_id}:`)
    console.log(`- UI answer visible: ${c.answer_visible ? 'yes' : 'no'}`)
    console.log(`- UI total ms: ${c.ui_total_ms}`)
    console.log(`- API ms: ${c.network_request_ms}`)
    console.log(`- model_used: ${c.model_used}`)
    console.log(`- retrieval_mode: ${c.retrieval_mode}`)
    console.log(`- answer chars: ${c.answer_char_count}`)
    console.log(`- answer excerpt: ${c.answer_excerpt_800_chars.slice(0, 120).replace(/\n/g, ' ')}…`)
    console.log(`- source types: ${c.source_types.join(', ')}`)
    console.log(`- refs: ${c.refs_count}`)
    console.log(`- leakage: ${c.leakage_result}`)
    console.log('')
  })

  const a = session.aggregate
  console.log('Aggregate:')
  console.log(`- cases: ${a.cases}`)
  console.log(`- UI pass: ${a.ui_pass}`)
  console.log(`- keyword/rule-engine: ${a.keyword_rule_engine}`)
  console.log(`- avg answer chars: ${a.avg_answer_chars}`)
  console.log(`- p50 UI ms: ${a.p50_ui_ms}`)
  console.log(`- p95 UI ms: ${a.p95_ui_ms}`)
  console.log(`- p50 API ms: ${a.p50_api_ms}`)
  console.log(`- p95 API ms: ${a.p95_api_ms}`)
  console.log(`- leakage: ${a.leakage}`)
  console.log(`- old boilerplate regression: ${a.old_boilerplate_regression}`)
}
