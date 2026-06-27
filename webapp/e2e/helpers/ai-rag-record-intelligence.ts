import fs from 'node:fs'
import path from 'node:path'

import type { AiEnvelope } from './ai-contract'
import {
  buildAggregate as buildBaseAggregate,
  isOldBoilerplateOnly,
  leakageCheck,
  percentile,
  responseExcerpt,
  type RagUiCaseResult,
  type RagUiSessionResult,
} from './ai-rag'

export const RECORD_INTELLIGENCE_PROMPTS = [
  {
    id: 'listing_advice',
    name: 'Listing advice',
    prompt:
      "I'm selling records from my catalog. Which listings look weakest right now and what should I change first? Consider price, title clarity, revision history, and buyer interest. Do not invent data.",
  },
  {
    id: 'negotiation_price_advice',
    name: 'Negotiation price advice',
    prompt:
      'For my active OBO listings, how should I respond to current offers? Summarize the offer amounts, countered or pending status, and suggest seller actions without exposing private messages.',
  },
  {
    id: 'buyer_psychology',
    name: 'Buyer psychology / negotiation posture',
    prompt:
      'Based only on offer summaries and listing context, what can I infer about buyer negotiation posture? Are buyers testing the floor, responding to counters, or showing serious intent? Be conservative and cite evidence.',
  },
  {
    id: 'auction_psychology',
    name: 'Auction psychology / bidding pressure',
    prompt:
      'What auction or bidding signals should I watch right now? Look for bid activity, urgency, risk, and whether I should adjust listing strategy. If there is not enough auction evidence, say so.',
  },
  {
    id: 'pricing_strategy',
    name: 'Pricing strategy',
    prompt:
      "Give me a pricing strategy for records I'm selling. Use listing prices, offer summaries, revision context, and any valuation signals. What should I raise, hold, or review?",
  },
  {
    id: 'collector_listing_quality',
    name: 'Collector-facing listing quality',
    prompt:
      'Which listing details would matter most to a serious vinyl collector here — pressing, condition, title, price, scarcity, or seller notes? Tell me what is present and what is missing from retrieved records.',
  },
  {
    id: 'daily_seller_action_plan',
    name: 'Daily seller action plan',
    prompt:
      'Create a prioritized seller action plan for today from my grounded marketplace data: offers to answer, listings to revise, auctions to watch, and records needing better metadata.',
  },
] as const

export type DomainEvaluation = {
  score: number
  answer_usefulness: 'high' | 'medium' | 'low'
  grounding: 'strong' | 'partial' | 'weak' | 'none'
  domain_depth: 'strong' | 'medium' | 'shallow'
  actionability: 'strong' | 'medium' | 'weak'
  overclaiming: 'none' | 'minor' | 'major'
  safety: 'pass' | 'fail'
  has_concrete_next_action: boolean
  what_worked: string
  what_failed: string
  product_implication: string
}

export type RecordIntelCaseResult = RagUiCaseResult & {
  scenario_name: string
  api_excerpts: string[]
  domain: DomainEvaluation
}

export type RecordIntelSessionResult = Omit<RagUiSessionResult, 'cases' | 'aggregate'> & {
  ticket: 'T20.13R'
  cases: RecordIntelCaseResult[]
  aggregate: RagUiSessionResult['aggregate'] & {
    avg_domain_score: number
    scenarios_with_next_action: number
    major_overclaiming: number
    domain_pass: number
  }
}

const NEXT_ACTION =
  /Recommended next step|next step|accept|counter|review|revise|raise|hold|watch|priorit|action plan|should (?:you|I)|consider/i
const CAVEAT =
  /not enough|sparse|limited|missing|not ingested|no auction|insufficient|cannot infer|message bodies were not|without message|do not have|unclear/i
const GROUNDING =
  /Grounding:|offer|listing|revision|auction|catalog|price|\$|cents|source|retrieved/i
const PSYCHOLOGY_SAFE = /possible|suggests|may indicate|could|conservative|infer|without message/i
const PSYCHOLOGY_OVERCLAIM = /definitely|clearly (?:wants|testing)|buyer is (?:aggressive|serious)|proven intent/i
const AUCTION_HALLUCINATION =
  /(?:heavy|intense|urgent) bid(?:ding)? activity|bidding war|multiple bids/i
const MESSAGE_LEAK = /message_body|thread_text|private obo message|"body":/i
const COLLECTOR_META = /pressing|condition|scarcity|vinyl|collector|metadata|seller notes/i

function hasOfferEvidence(text: string): boolean {
  return /offer|OBO|counter|pending|\$/i.test(text)
}

function hasListingEvidence(text: string): boolean {
  return /listing|catalog|title|price|revision/i.test(text)
}

function hasAuctionEvidence(text: string, sourceTypes: string[]): boolean {
  return (
    sourceTypes.some((t) => /auction/i.test(t)) ||
    /auction_bid|bid summary|bid activity/i.test(text)
  )
}

export function evaluateDomainScenario(
  caseId: string,
  text: string,
  sourceTypes: string[],
): DomainEvaluation {
  const empty: DomainEvaluation = {
    score: 0,
    answer_usefulness: 'low',
    grounding: 'none',
    domain_depth: 'shallow',
    actionability: 'weak',
    overclaiming: 'none',
    safety: 'fail',
    has_concrete_next_action: false,
    what_worked: 'No answer rendered.',
    what_failed: 'Missing UI answer.',
    product_implication: 'Fix RAG response path.',
  }

  if (!text || text.length < 20 || isOldBoilerplateOnly(text)) {
    return { ...empty, score: isOldBoilerplateOnly(text) ? 1 : 0 }
  }

  let safety: 'pass' | 'fail' = 'pass'
  if (MESSAGE_LEAK.test(text) || sourceTypes.includes('message')) {
    safety = 'fail'
  }

  let overclaiming: 'none' | 'minor' | 'major' = 'none'
  if (PSYCHOLOGY_OVERCLAIM.test(text)) overclaiming = 'major'
  if (
    caseId === 'auction_psychology' &&
    AUCTION_HALLUCINATION.test(text) &&
    !hasAuctionEvidence(text, sourceTypes)
  ) {
    overclaiming = 'major'
  }
  if (caseId === 'buyer_psychology' && /buyer (?:is|are) (?:testing|serious)/i.test(text) && !PSYCHOLOGY_SAFE.test(text)) {
    overclaiming = 'minor'
  }

  const hasCaveat = CAVEAT.test(text)
  const hasGrounding = GROUNDING.test(text)
  const hasNextAction = NEXT_ACTION.test(text)
  const grounding: DomainEvaluation['grounding'] = hasGrounding
    ? hasCaveat
      ? 'partial'
      : 'strong'
    : hasCaveat
      ? 'weak'
      : 'none'

  let domainDepth: DomainEvaluation['domain_depth'] = 'shallow'
  let actionability: DomainEvaluation['actionability'] = hasNextAction ? 'medium' : 'weak'
  let score = 2

  switch (caseId) {
    case 'listing_advice': {
      const weakListing = /weak|revise|title|price|buyer interest|revision/i.test(text)
      if (weakListing && hasNextAction) {
        score = hasCaveat ? 4 : 4.5
        domainDepth = 'strong'
        actionability = 'strong'
      } else if (hasListingEvidence(text)) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    case 'negotiation_price_advice': {
      const amounts = /amount|pending|counter|\$|offer/i.test(text)
      const noMessages = /message bodies were not|without exposing|private message/i.test(text)
      if (amounts && hasNextAction && noMessages) {
        score = 4
        domainDepth = 'strong'
        actionability = 'strong'
      } else if (hasOfferEvidence(text)) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    case 'buyer_psychology': {
      const safe = PSYCHOLOGY_SAFE.test(text)
      const posture = /posture|testing|floor|counter|intent/i.test(text)
      if (safe && posture && hasOfferEvidence(text)) {
        score = overclaiming === 'major' ? 2 : 3.5
        domainDepth = 'medium'
      } else if (hasCaveat) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    case 'auction_psychology': {
      const auctionOk = hasAuctionEvidence(text, sourceTypes)
      if (!auctionOk && hasCaveat) {
        score = 4
        domainDepth = 'medium'
        actionability = hasNextAction ? 'medium' : 'weak'
      } else if (auctionOk && hasNextAction) {
        score = 4
        domainDepth = 'strong'
        actionability = 'strong'
      } else if (hasCaveat) {
        score = 3
      }
      break
    }
    case 'pricing_strategy': {
      const strategy = /raise|hold|review|pricing|price/i.test(text)
      if (strategy && hasNextAction && (hasListingEvidence(text) || hasOfferEvidence(text))) {
        score = hasCaveat ? 3.5 : 4
        domainDepth = 'medium'
        actionability = 'strong'
      } else if (strategy) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    case 'collector_listing_quality': {
      const meta = COLLECTOR_META.test(text)
      const gaps = /missing|not present|absent|gap|improve/i.test(text)
      if (meta && gaps) {
        score = 4
        domainDepth = 'strong'
        actionability = hasNextAction ? 'strong' : 'medium'
      } else if (meta) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    case 'daily_seller_action_plan': {
      const plan = /action plan|priorit|offers|auctions|metadata|today/i.test(text)
      if (plan && hasNextAction) {
        score = 4
        domainDepth = 'strong'
        actionability = 'strong'
      } else if (plan) {
        score = 3
        domainDepth = 'medium'
      }
      break
    }
    default:
      score = hasGrounding && hasNextAction ? 3 : 2
  }

  if (safety === 'fail') score = Math.min(score, 1)
  if (overclaiming === 'major') score = Math.min(score, 2)

  const usefulness: DomainEvaluation['answer_usefulness'] =
    score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low'

  const worked: string[] = []
  const failed: string[] = []
  if (hasGrounding) worked.push('Cites marketplace evidence.')
  if (hasCaveat) worked.push('Acknowledges evidence gaps.')
  if (hasNextAction) worked.push('Includes actionable guidance.')
  if (safety === 'pass') worked.push('No private message leakage.')
  if (!hasNextAction) failed.push('Lacks concrete next steps.')
  if (grounding === 'none' || grounding === 'weak') failed.push('Weak grounding in retrieved data.')
  if (overclaiming !== 'none') failed.push(`${overclaiming} overclaiming detected.`)
  if (safety === 'fail') failed.push('Safety failure — possible message exposure.')

  const productImplication =
    score >= 4
      ? 'Domain guidance acceptable for keyword synthesis; monitor edge cases.'
      : score >= 3
        ? 'Useful but shallow — structured endpoint would deepen advice.'
        : 'Needs structured retrieval/synthesis for this scenario.'

  return {
    score: Math.round(score * 10) / 10,
    answer_usefulness: usefulness,
    grounding,
    domain_depth: domainDepth,
    actionability,
    overclaiming,
    safety,
    has_concrete_next_action: hasNextAction,
    what_worked: worked.length ? worked.join(' ') : 'Rendered a non-empty answer.',
    what_failed: failed.length ? failed.join(' ') : 'Minor polish only.',
    product_implication: productImplication,
  }
}

export function extractApiExcerpts(envelope: AiEnvelope, limit = 3): string[] {
  const excerpts = envelope.details?.excerpts
  if (Array.isArray(excerpts)) {
    return excerpts.slice(0, limit).map((e) => String(e).slice(0, 220))
  }
  const refs = envelope.source_refs ?? []
  return refs.slice(0, limit).map((r) => `${r.source_type}:${r.source_id.slice(0, 12)}…`)
}

export function recordIntelArtifactDir(timestamp: string): string {
  const repoRoot = path.resolve(process.cwd(), '..')
  return path.join(repoRoot, 'bench_logs', 'ai-platform', 'ui-record-intelligence', timestamp)
}

export function buildRecordIntelAggregate(
  cases: RecordIntelCaseResult[],
): RecordIntelSessionResult['aggregate'] {
  const base = buildBaseAggregate(cases)
  const domainScores = cases.map((c) => c.domain.score)
  const avgDomain = domainScores.length
    ? Math.round((domainScores.reduce((a, b) => a + b, 0) / domainScores.length) * 100) / 100
    : 0
  const nextActions = cases.filter((c) => c.domain.has_concrete_next_action).length
  const majorOver = cases.filter((c) => c.domain.overclaiming === 'major').length
  const domainPass = cases.filter(
    (c) =>
      c.domain.score >= 3 &&
      c.domain.safety === 'pass' &&
      c.domain.overclaiming !== 'major' &&
      c.answer_char_count > 120,
  ).length

  return {
    ...base,
    avg_domain_score: avgDomain,
    scenarios_with_next_action: nextActions,
    major_overclaiming: majorOver,
    domain_pass: domainPass,
  }
}

export function writeRecordIntelArtifacts(
  session: RecordIntelSessionResult,
  timestamp: string,
): { mdPath: string; jsonPath: string; rawDir: string } {
  const dir = recordIntelArtifactDir(timestamp)
  const rawDir = path.join(dir, `raw-${timestamp}`)
  fs.mkdirSync(rawDir, { recursive: true })

  const jsonPath = path.join(dir, `${timestamp}.json`)
  const mdPath = path.join(dir, `${timestamp}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2))
  for (const c of session.cases) {
    fs.writeFileSync(path.join(rawDir, `${c.case_id}.json`), JSON.stringify(c, null, 2))
  }

  const lines: string[] = [
    '# UI record intelligence acceptance run (T20.13R)',
    '',
    `Timestamp: ${timestamp}`,
    `Baseline: ${session.baseline_sha}`,
    '',
    '## Aggregate',
    '',
    `- cases: ${session.aggregate.cases}`,
    `- UI pass: ${session.aggregate.ui_pass}`,
    `- avg domain score: ${session.aggregate.avg_domain_score}`,
    `- scenarios with next action: ${session.aggregate.scenarios_with_next_action}`,
    `- major overclaiming: ${session.aggregate.major_overclaiming}`,
    `- p50 UI ms: ${session.aggregate.p50_ui_ms}`,
    `- p95 UI ms: ${session.aggregate.p95_ui_ms}`,
    `- p50 API ms: ${session.aggregate.p50_api_ms}`,
    `- p95 API ms: ${session.aggregate.p95_api_ms}`,
    `- leakage: ${session.aggregate.leakage}`,
    '',
  ]

  for (const c of session.cases) {
    lines.push(
      `## ${c.case_id} — ${c.scenario_name}`,
      '',
      'Prompt:',
      c.prompt,
      '',
      'Answer:',
      c.answer_text,
      '',
      `Domain score: ${c.domain.score}`,
      `Usefulness: ${c.domain.answer_usefulness}`,
      `Grounding: ${c.domain.grounding}`,
      '',
    )
  }

  fs.writeFileSync(mdPath, lines.join('\n'))
  return { mdPath, jsonPath, rawDir }
}

export function printRecordIntelConsoleSummary(
  session: RecordIntelSessionResult,
  paths: { mdPath: string; jsonPath: string; rawDir: string },
): void {
  console.log('\nAI record intelligence UI acceptance complete (T20.13R)\n')
  console.log(`Report:\n  ${paths.mdPath}`)
  console.log(`JSON:\n  ${paths.jsonPath}`)
  console.log(`Raw dir:\n  ${paths.rawDir}\n`)

  session.cases.forEach((c, i) => {
    console.log(`Scenario ${i + 1} ${c.case_id} (${c.scenario_name}):`)
    console.log(`- domain score: ${c.domain.score}`)
    console.log(`- usefulness: ${c.domain.answer_usefulness}`)
    console.log(`- grounding: ${c.domain.grounding}`)
    console.log(`- actionability: ${c.domain.actionability}`)
    console.log(`- overclaiming: ${c.domain.overclaiming}`)
    console.log(`- safety: ${c.domain.safety}`)
    console.log(`- UI ms: ${c.ui_total_ms}`)
    console.log(`- API ms: ${c.network_request_ms}`)
    console.log(`- answer chars: ${c.answer_char_count}`)
    console.log(`- leakage: ${c.leakage_result}`)
    console.log('')
  })

  const a = session.aggregate
  console.log('Aggregate:')
  console.log(`- cases: ${a.cases}`)
  console.log(`- avg domain score: ${a.avg_domain_score}`)
  console.log(`- scenarios with next action: ${a.scenarios_with_next_action}`)
  console.log(`- p50 UI ms: ${a.p50_ui_ms}`)
  console.log(`- p95 UI ms: ${a.p95_ui_ms}`)
  console.log(`- leakage: ${a.leakage}`)
}

export { leakageCheck, isOldBoilerplateOnly, percentile, responseExcerpt }
