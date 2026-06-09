import type { APIRequestContext, APIResponse } from '@playwright/test'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retry API calls that hit auth/listings rate limits during long E2E suites. */
export async function with429Retry(
  label: string,
  fn: () => Promise<APIResponse>,
  opts?: { attempts?: number },
): Promise<APIResponse> {
  const attempts = opts?.attempts ?? 10
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fn()
    if (res.status() !== 429) return res
    await sleep(Math.min(12_000, 2000 * (attempt + 1)))
  }
  throw new Error(`${label} failed after ${attempts} attempts: 429 Too many requests`)
}

export async function getJsonWith429Retry<T>(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<T> {
  const res = await with429Retry(label, () =>
    request.get(url, { headers: { ...headers, 'X-RP-E2E-Contract': '1' } }),
  )
  const text = await res.text()
  if (!res.ok()) {
    throw new Error(`${label} failed ${res.status()}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as T
}

export async function postJsonWith429Retry<T>(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
  data: unknown,
  label: string,
): Promise<T> {
  const res = await with429Retry(label, () =>
    request.post(url, {
      headers: { ...headers, 'X-RP-E2E-Contract': '1', 'Content-Type': 'application/json' },
      data,
    }),
  )
  const text = await res.text()
  if (!res.ok()) {
    throw new Error(`${label} failed ${res.status()}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text) as T
}
