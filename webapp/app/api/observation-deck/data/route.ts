import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'

/**
 * Observation deck data: pgbench TPS/latency, k6 log paths, EXPLAIN dir, observability stack status.
 * Reads from bench_logs/preflight-results.json (written by write-preflight-summary-md.sh).
 * Set PREFLIGHT_JSON_PATH to override (absolute or relative to cwd).
 */
export async function GET() {
  try {
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
      return NextResponse.json(
        {
          generated_at: null,
          preflight_summary_md: null,
          pgbench: [],
          explain_dir: null,
          suite_log_dir: null,
          k6_logs: [],
          observation_deck_summary: 'Run full preflight to generate bench_logs/preflight-results.json',
        },
        { status: 200 }
      )
    }
    const data = JSON.parse(raw) as Record<string, unknown>
    return NextResponse.json(data, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load observation deck data' },
      { status: 500 }
    )
  }
}
