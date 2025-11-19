import os from 'node:os'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const encoder = new TextEncoder()
const sources = ['discogs', 'ebay', 'records-service', 'kafka']
const events = ['price_drop', 'new_bid', 'watch_added', 'shipped', 'export_ready']
const currencies = ['USD', 'EUR', 'GBP', 'JPY']

const DEFAULT_ORIGINS = [
  'https://record-platform.dev',
  'http://localhost:3000',
  'http://localhost:3001',
]

function buildHeaders(origin?: string) {
  const allowOrigin = origin && DEFAULT_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGINS[0]
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}

function randomChoice<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function buildEvent() {
  const now = new Date()
  return {
    id: `${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    topic: 'record-platform.activity',
    source: randomChoice(sources),
    event: randomChoice(events),
    price: Math.round((50 + Math.random() * 250) * 100) / 100,
    currency: randomChoice(currencies),
    marketplaceRef: `LP-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
    ts: now.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const cores = Math.max(1, os.cpus().length)
  const intervalMs = Math.max(1500, Math.round(6000 / cores))
  const headers = buildHeaders(req.headers.get('origin') ?? undefined)

  let timer: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    start(controller) {
      const push = () => {
        const payload = buildEvent()
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      push()
      timer = setInterval(push, intervalMs)
      const abort = () => {
        if (timer) clearInterval(timer)
        controller.close()
      }
      req.signal.addEventListener('abort', abort)
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })

  return new Response(stream, { headers })
}

export function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: buildHeaders(req.headers.get('origin') ?? undefined),
  })
}

