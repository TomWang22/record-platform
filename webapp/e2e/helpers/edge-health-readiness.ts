import type { APIRequestContext } from '@playwright/test'

import { with429Retry } from './http-retry'

export const EDGE_HEALTH_ENDPOINTS = [
  '/api/readyz',
  '/api/healthz',
  '/api/auth/healthz',
  '/api/listings/healthz',
  '/api/trust/healthz',
] as const

/** Poll edge + service health endpoints before screenshot/health contract runs. */
export async function pollEdgeHealthReady(
  request: APIRequestContext,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs
  let last = ''

  while (Date.now() < deadline) {
    let allOk = true
    for (const ep of EDGE_HEALTH_ENDPOINTS) {
      const res = await with429Retry(
        `edge health ${ep}`,
        () => request.get(ep, { maxRedirects: 5 }),
        { attempts: 12 },
      )
      last = `${ep} → HTTP ${res.status()}`
      if (!res.ok()) {
        allOk = false
        break
      }
    }
    if (allOk) return
    await new Promise((r) => setTimeout(r, 2000))
  }

  throw new Error(`edge health not ready within ${timeoutMs}ms (last: ${last})`)
}
