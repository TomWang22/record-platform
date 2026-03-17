import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

function resolveObservationDeckData(): Record<string, unknown> {
  const cwd = process.cwd()
  const explicit = process.env.PREFLIGHT_JSON_PATH
  const candidates = explicit
    ? [path.resolve(cwd, explicit)]
    : [
        path.join(cwd, 'bench_logs', 'preflight-results.json'),
        path.join(cwd, '..', 'bench_logs', 'preflight-results.json'),
      ]
  let raw: string | null = null
  for (const p of candidates) {
    try {
      raw = fs.readFileSync(p, 'utf-8')
      break
    } catch {
      continue
    }
  }
  if (!raw) {
    return {
      generated_at: null,
      preflight_summary_md: null,
      pgbench: [],
      explain_dir: null,
      suite_log_dir: null,
      k6_logs: [],
      protocol_comparison: null,
      observation_deck_summary: 'Run full preflight to generate bench_logs/preflight-results.json',
    }
  }
  return JSON.parse(raw) as Record<string, unknown>
}

async function runGraphQL(query: string) {
  if (query.includes('observationDeckData')) {
    const data = resolveObservationDeckData()
    return { data: { observationDeckData: data } }
  }
  return { errors: [{ message: 'Unknown query; use { observationDeckData { pgbench { db tps latency_ms } k6_logs observation_deck_summary } }' }] }
}

/**
 * GraphQL endpoint for observation deck: query { observationDeckData { pgbench { db tps latency_ms } k6_logs observation_deck_summary } }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const query = (body.query as string) || ''
    const result = await runGraphQL(query)
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { errors: [{ message: e instanceof Error ? e.message : 'GraphQL error' }] },
      { status: 200 }
    )
  }
}
