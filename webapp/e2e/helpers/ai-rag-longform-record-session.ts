import fs from 'node:fs'
import path from 'node:path'

import type { AiEnvelope } from './ai-contract'
import {
  isOldBoilerplateOnly,
  leakageCheck,
  percentile,
  responseExcerpt,
} from './ai-rag'

export const LONGFORM_TURNS = [
  {
    id: 'catalog_health',
    theme: 'Catalog health',
    prompt:
      "I'm selling records from my catalog. Give me a grounded health check: weak listings, buyer interest, revisions, and pricing risks. Do not invent data.",
  },
  {
    id: 'prioritized_action_list',
    theme: 'Prioritized action list (30 min)',
    prompt:
      'Assume I only have 30 minutes today. Turn that into a prioritized action list. Focus on actions that could improve conversion or avoid losing an offer.',
  },
  {
    id: 'negotiation_strategy',
    theme: 'Negotiation strategy',
    prompt:
      'For active OBO or offer activity, what should I accept, counter, or review? Explain the negotiation logic conservatively using only offer summaries and listing context.',
  },
  {
    id: 'buyer_psychology',
    theme: 'Buyer psychology',
    prompt:
      'What can I infer about buyer intent or negotiation posture? Are buyers testing the floor, responding to counters, or showing serious intent? Use cautious language and cite evidence.',
  },
  {
    id: 'auction_pressure',
    theme: 'Auction pressure',
    prompt:
      'Now focus on auction or bidding signals. Is there urgency, thin demand, bid risk, or anything I should watch? If auction evidence is sparse, say so clearly.',
  },
  {
    id: 'collector_metadata',
    theme: 'Collector metadata quality',
    prompt:
      'Think like a serious vinyl collector. Which listing details are missing or weak: pressing, condition, title, price, scarcity, seller notes, or provenance?',
  },
  {
    id: 'listing_rewrite',
    theme: 'Listing rewrite request',
    prompt:
      'Pick one listing from the retrieved evidence and draft a better collector-facing listing title and description. Do not add facts that are not in the records.',
  },
  {
    id: 'pricing_plan',
    theme: 'Pricing plan',
    prompt:
      'Give me a raise / hold / review pricing plan. Use listing prices, offer amounts, revision context, and valuation signals if present.',
  },
  {
    id: 'user_tradeoff_rerank',
    theme: 'User tradeoff re-rank',
    prompt:
      'Additional seller context: I care more about moving stale inventory than maximizing top dollar. I also want to avoid underselling rare jazz records. Re-rank your advice with that tradeoff.',
  },
  {
    id: 'final_action_plan_long',
    theme: 'Long prompt stress — final plan',
    prompt: `Using everything above, produce a final seller action plan for today. Include:
1. urgent offer actions
2. listings to revise
3. pricing moves
4. collector metadata improvements
5. auction/bid watch items
6. what evidence is missing
7. what you are not allowed to infer

Keep it grounded and conservative.`,
  },
  {
    id: 'red_team_overclaim',
    theme: 'Red-team overclaiming check',
    prompt:
      'Review your own advice. Identify any place where you may have overclaimed buyer psychology, rarity, auction urgency, or condition. Rewrite those parts more conservatively.',
  },
  {
    id: 'executive_summary',
    theme: 'Final executive summary',
    prompt:
      'Give me a final 10-bullet seller plan I can act on today, with each bullet tagged as [grounded], [missing evidence], or [needs manual review].',
  },
] as const

export type LongformTurnEvaluation = {
  score: number
  grounding: 'strong' | 'partial' | 'weak' | 'none'
  actionability: 'strong' | 'medium' | 'weak'
  domain_depth: 'strong' | 'medium' | 'shallow'
  overclaiming: 'none' | 'minor' | 'major'
  context_retention: 'good' | 'partial' | 'poor' | 'n/a'
  safety: 'pass' | 'fail'
  has_concrete_next_action: boolean
  what_worked: string
  what_failed: string
}

export type LongformTurnResult = {
  turn_id: string
  turn_index: number
  theme: string
  prompt: string
  prompt_chars: number
  estimated_prompt_tokens: number
  accumulated_context_chars: number
  ui_total_ms: number
  api_ms: number
  http_status: number
  retrieval_mode: string
  model_used: string
  synthesis_template: string | null
  answer_text: string
  answer_chars: number
  answer_excerpt_1000: string
  source_types: string[]
  refs_count: number
  visible_source_refs_count: number
  api_source_excerpt_1: string
  api_source_excerpt_2: string
  leakage_result: string
  old_boilerplate_present: boolean
  timeout: boolean
  error_message: string | null
  shadow_selected_count: number | null
  shadow_source_types: string[]
  evaluation: LongformTurnEvaluation
}

export type LongformSessionResult = {
  ticket: 'T20.13V'
  mode: 'ui'
  baseline_sha: string
  run_timestamp: string
  base_url: string
  browser: string
  login_user: string
  command: string
  runtime_config: {
    ai_model_provider: string
    rag_max_context_tokens: number
    rag_max_chunks: number
    max_response_tokens: number
    generative_ollama_for_rag: boolean
  }
  turns: LongformTurnResult[]
  aggregate: {
    turns: number
    turns_pass: number
    avg_score: number
    final_turn_score: number
    max_prompt_chars: number
    max_estimated_tokens: number
    scenarios_with_next_action: number
    context_retention_turns_9_12: 'good' | 'partial' | 'poor'
    p50_ui_ms: number
    p95_ui_ms: number
    p50_api_ms: number
    p95_api_ms: number
    leakage: string
    http_500_count: number
    old_boilerplate_regression: boolean
  }
}

const NEXT_ACTION =
  /Recommended next step|next step|accept|counter|review|revise|raise|hold|watch|priorit|action plan|bullet|\d\.|\[grounded\]/i
const CAVEAT =
  /not enough|sparse|limited|missing|not ingested|no auction|insufficient|cannot infer|message bodies were not|without message|do not have|unclear|not allowed to infer/i
const GROUNDING =
  /Grounding:|offer|listing|revision|auction|catalog|price|\$|cents|source|retrieved|evidence/i
const PSYCHOLOGY_OVERCLAIM = /definitely|clearly (?:wants|testing)|buyer is (?:aggressive|serious)|proven intent/i
const MESSAGE_LEAK = /message_body|thread_text|private obo message/i
const TAG_PATTERN = /\[(grounded|missing evidence|needs manual review)\]/i

function estTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

export function buildAccumulatedContext(prior: LongformTurnResult[], maxChars = 6000): string {
  const blocks = prior.map(
    (t) => `Turn ${t.turn_index} (${t.theme}): ${t.answer_text.slice(0, 400).replace(/\s+/g, ' ').trim()}`,
  )
  let text = blocks.join('\n\n')
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…[truncated]'
  return text
}

export function buildTurnPrompt(
  turnIndex: number,
  prior: LongformTurnResult[],
): { prompt: string; accumulated_context_chars: number } {
  const turn = LONGFORM_TURNS[turnIndex - 1]
  if (turnIndex <= 9) {
    return { prompt: turn.prompt, accumulated_context_chars: 0 }
  }

  const accumulated = buildAccumulatedContext(prior)
  const prefs =
    turnIndex >= 10
      ? '\n\nUSER PREFERENCES: Move stale inventory over max price; avoid underselling rare jazz. Only 30 minutes available today.\n\nCAUTION: Do not invent pressing/condition/scarcity. No private messages. Conservative inference only.\n\n'
      : '\n\n'
  const prompt = `ACCUMULATED SESSION CONTEXT:\n${accumulated}${prefs}${turn.prompt}`
  return { prompt, accumulated_context_chars: accumulated.length + prefs.length }
}

export function evaluateLongformTurn(
  turnId: string,
  turnIndex: number,
  prompt: string,
  answer: string,
  sourceTypes: string[],
  accumulatedContextChars: number,
): LongformTurnEvaluation {
  const empty: LongformTurnEvaluation = {
    score: 0,
    grounding: 'none',
    actionability: 'weak',
    domain_depth: 'shallow',
    overclaiming: 'none',
    context_retention: turnIndex >= 9 ? 'poor' : 'n/a',
    safety: 'fail',
    has_concrete_next_action: false,
    what_worked: 'No answer.',
    what_failed: 'Missing or unsafe answer.',
  }
  if (!answer || answer.length < 20 || isOldBoilerplateOnly(answer)) {
    return { ...empty, score: isOldBoilerplateOnly(answer) ? 1 : 0 }
  }

  let safety: 'pass' | 'fail' = MESSAGE_LEAK.test(answer) || sourceTypes.includes('message') ? 'fail' : 'pass'
  let overclaiming: LongformTurnEvaluation['overclaiming'] = PSYCHOLOGY_OVERCLAIM.test(answer) ? 'major' : 'none'
  const hasCaveat = CAVEAT.test(answer)
  const hasGrounding = GROUNDING.test(answer)
  const hasNext = NEXT_ACTION.test(answer)
  const grounding: LongformTurnEvaluation['grounding'] = hasGrounding
    ? hasCaveat
      ? 'partial'
      : 'strong'
    : hasCaveat
      ? 'weak'
      : 'none'

  let score = 2.5
  let domainDepth: LongformTurnEvaluation['domain_depth'] = 'medium'
  let actionability: LongformTurnEvaluation['actionability'] = hasNext ? 'medium' : 'weak'
  let contextRetention: LongformTurnEvaluation['context_retention'] =
    turnIndex < 9 ? 'n/a' : 'partial'

  if (turnIndex >= 9) {
    const staleJazz = /stale|jazz|rare|inventory|tradeoff|move|undersell/i.test(answer)
    contextRetention = staleJazz ? 'good' : accumulatedContextChars > 0 ? 'partial' : 'poor'
  }

  switch (turnId) {
    case 'catalog_health':
      score = hasGrounding && hasNext ? 4 : 3
      break
    case 'prioritized_action_list':
      score = /priorit|30 minute|minute|urgent|offer/i.test(answer) && hasNext ? 4 : 3
      break
    case 'negotiation_strategy':
      score = /offer|counter|pending|accept|review/i.test(answer) ? 3.5 : 2.5
      break
    case 'buyer_psychology':
      score = overclaiming === 'major' ? 2 : hasGrounding ? 3 : 2
      break
    case 'auction_pressure':
      score = hasGrounding && (hasCaveat || /auction|bid/i.test(answer)) ? 3.5 : 2.5
      break
    case 'collector_metadata':
      score = /pressing|condition|scarcity|collector|metadata|missing|weak/i.test(answer) ? 3 : 2
      break
    case 'listing_rewrite':
      score = /title|description|listing/i.test(answer) && !/lorem/i.test(answer) ? 3.5 : 2
      break
    case 'pricing_plan':
      score = /raise|hold|review|price/i.test(answer) ? 3.5 : 2.5
      break
    case 'user_tradeoff_rerank':
      score = /stale|jazz|rare|inventory/i.test(answer) ? 3.5 : 2
      if (!/stale|jazz|rare/i.test(answer)) contextRetention = 'poor'
      break
    case 'final_action_plan_long':
      score =
        hasNext && /missing|evidence|not allowed|infer/i.test(answer) && answer.length > 200 ? 4 : 3
      domainDepth = answer.length > 300 ? 'strong' : 'medium'
      break
    case 'red_team_overclaim':
      score = /conservative|overclaim|may have|rewrite|caution|possible/i.test(answer) ? 3.5 : 2.5
      break
    case 'executive_summary':
      score = TAG_PATTERN.test(answer) && hasNext ? 4 : hasNext ? 3 : 2
      if (TAG_PATTERN.test(answer)) contextRetention = 'good'
      break
    default:
      score = hasGrounding ? 3 : 2
  }

  if (safety === 'fail') score = Math.min(score, 1)
  if (overclaiming === 'major') score = Math.min(score, 2)

  const worked: string[] = []
  const failed: string[] = []
  if (hasGrounding) worked.push('Grounded in retrieved evidence.')
  if (hasCaveat) worked.push('Acknowledges gaps.')
  if (hasNext) worked.push('Actionable structure.')
  if (turnIndex >= 9 && contextRetention === 'good') worked.push('Retained session constraints.')
  if (!hasNext) failed.push('Weak next-step guidance.')
  if (turnIndex >= 9 && contextRetention === 'poor') failed.push('Lost prior-turn user constraints.')

  return {
    score: Math.round(score * 10) / 10,
    grounding,
    actionability,
    domain_depth: domainDepth,
    overclaiming,
    context_retention: contextRetention,
    safety,
    has_concrete_next_action: hasNext,
    what_worked: worked.join(' ') || 'Non-empty answer.',
    what_failed: failed.join(' ') || 'Minor gaps only.',
  }
}

export function extractApiExcerpts(envelope: AiEnvelope, limit = 2): string[] {
  const excerpts = envelope.details?.excerpts
  if (Array.isArray(excerpts)) return excerpts.slice(0, limit).map((e) => String(e).slice(0, 220))
  const refs = envelope.source_refs ?? []
  return refs.slice(0, limit).map((r) => `${r.source_type}:${r.source_id.slice(0, 12)}…`)
}

export function extractShadowTelemetry(envelope: AiEnvelope): {
  shadow_selected_count: number | null
  shadow_source_types: string[]
} {
  const shadow = envelope.details?.shadow_vector as Record<string, unknown> | undefined
  const diag = envelope.details?.shadow_diagnostics as Record<string, unknown> | undefined
  const selected =
    typeof shadow?.selected_count === 'number'
      ? shadow.selected_count
      : typeof shadow?.chunk_count === 'number'
        ? shadow.chunk_count
        : null
  const types = diag?.shadow_source_types ?? shadow?.source_types
  return {
    shadow_selected_count: selected,
    shadow_source_types: Array.isArray(types) ? types.map(String) : [],
  }
}

export function longformArtifactDir(timestamp: string): string {
  const repoRoot = path.resolve(process.cwd(), '..')
  return path.join(repoRoot, 'bench_logs', 'ai-platform', 'longform-rag-session', timestamp)
}

export function buildLongformAggregate(turns: LongformTurnResult[]): LongformSessionResult['aggregate'] {
  const scores = turns.map((t) => t.evaluation.score)
  const uiMs = turns.map((t) => t.ui_total_ms)
  const apiMs = turns.map((t) => t.api_ms)
  const pass = turns.filter(
    (t) =>
      t.http_status === 200 &&
      t.answer_chars > 80 &&
      t.retrieval_mode === 'keyword' &&
      t.model_used === 'rule-engine' &&
      t.leakage_result === 'PASS' &&
      !t.old_boilerplate_present &&
      t.evaluation.safety === 'pass',
  ).length

  const ctxTurns = turns.filter((t) => t.turn_index >= 9)
  const ctxGood = ctxTurns.filter((t) => t.evaluation.context_retention === 'good').length
  const ctxPartial = ctxTurns.filter((t) => t.evaluation.context_retention === 'partial').length
  const contextRetention: LongformSessionResult['aggregate']['context_retention_turns_9_12'] =
    ctxGood >= 2 ? 'good' : ctxPartial + ctxGood >= 2 ? 'partial' : 'poor'

  return {
    turns: turns.length,
    turns_pass: pass,
    avg_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
    final_turn_score: turns.length ? turns[turns.length - 1].evaluation.score : 0,
    max_prompt_chars: Math.max(...turns.map((t) => t.prompt_chars), 0),
    max_estimated_tokens: Math.max(...turns.map((t) => t.estimated_prompt_tokens), 0),
    scenarios_with_next_action: turns.filter((t) => t.evaluation.has_concrete_next_action).length,
    context_retention_turns_9_12: contextRetention,
    p50_ui_ms: percentile(uiMs, 50),
    p95_ui_ms: percentile(uiMs, 95),
    p50_api_ms: percentile(apiMs, 50),
    p95_api_ms: percentile(apiMs, 95),
    leakage: turns.some((t) => t.leakage_result !== 'PASS') ? 'FAIL' : 'PASS',
    http_500_count: turns.filter((t) => t.http_status >= 500).length,
    old_boilerplate_regression: turns.some((t) => t.old_boilerplate_present),
  }
}

export function writeLongformArtifacts(session: LongformSessionResult, timestamp: string): {
  jsonPath: string
  mdPath: string
  rawDir: string
} {
  const dir = longformArtifactDir(timestamp)
  const rawDir = path.join(dir, `raw-${timestamp}`)
  fs.mkdirSync(rawDir, { recursive: true })
  const jsonPath = path.join(dir, `${timestamp}.json`)
  const mdPath = path.join(dir, `${timestamp}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2))
  for (const t of session.turns) {
    fs.writeFileSync(path.join(rawDir, `turn-${String(t.turn_index).padStart(2, '0')}-${t.turn_id}.json`), JSON.stringify(t, null, 2))
  }
  const lines = ['# Longform record RAG gauntlet', '', `Timestamp: ${timestamp}`, '']
  for (const t of session.turns) {
    lines.push(`## Turn ${t.turn_index} — ${t.theme}`, '', t.prompt.slice(0, 500), '', t.answer_text, '', `Score: ${t.evaluation.score}`, '')
  }
  fs.writeFileSync(mdPath, lines.join('\n'))
  return { jsonPath, mdPath, rawDir }
}

export function printLongformConsoleSummary(session: LongformSessionResult, paths: { jsonPath: string }): void {
  console.log('\nLongform record RAG gauntlet complete (T20.13V)\n')
  console.log(`JSON: ${paths.jsonPath}`)
  session.turns.forEach((t) => {
    console.log(
      `Turn ${t.turn_index} ${t.turn_id}: score=${t.evaluation.score} http=${t.http_status} ui=${t.ui_total_ms}ms prompt=${t.prompt_chars}chars answer=${t.answer_chars}chars`,
    )
  })
  const a = session.aggregate
  console.log(`\nAggregate: ${a.turns_pass}/${a.turns} pass · avg ${a.avg_score} · final ${a.final_turn_score} · p95 UI ${a.p95_ui_ms}ms`)
}
