import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { ensureMarketplaceSeed, type MarketplaceSeedResult } from './seed-marketplace'
import {
  mergeAuthStats,
  readContractAuthCache,
  writeContractAuthCache,
  type ContractAuthCache,
} from './auth-contract-cache'

const TEST_PASSWORD = 'ContractPass123!'
export const AUTH_EMAIL = 'e2e-contract@record-platform.local'
export const SELLER_CONTRACT_EMAIL = 'seller-contract@record-platform.local'
export const BUYER_CONTRACT_EMAIL = 'buyer-contract@record-platform.local'
const TEST_NAME = 'Test Collector'
const SELLER_NAME = 'Seller Contract'
const BUYER_NAME = 'Buyer Contract'

const PROFILE_BY_EMAIL: Record<string, { name: string; initials: string }> = {
  [AUTH_EMAIL]: { name: TEST_NAME, initials: 'TC' },
  [SELLER_CONTRACT_EMAIL]: { name: SELLER_NAME, initials: 'SC' },
  [BUYER_CONTRACT_EMAIL]: { name: BUYER_NAME, initials: 'BC' },
}

const memoryTokens = new Map<string, string>()

function loadDiskTokens(): void {
  const disk = readContractAuthCache()
  if (!disk?.tokens) return
  for (const [email, token] of Object.entries(disk.tokens)) {
    if (token) memoryTokens.set(email, token)
  }
}

loadDiskTokens()

function bumpStats(partial: Partial<ContractAuthCache['stats']>): void {
  mergeAuthStats(partial)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function loginOnce(
  request: APIRequestContext,
  email: string,
): Promise<{ ok: boolean; status: number; token?: string; body: string }> {
  bumpStats({ loginAttempts: (readContractAuthCache()?.stats.loginAttempts ?? 0) + 1 })
  const res = await request.post('/api/auth/login', {
    data: { email, password: TEST_PASSWORD },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  const body = await res.text()
  if (res.ok()) {
    try {
      const data = JSON.parse(body) as { token?: string }
      if (data.token) return { ok: true, status: res.status(), token: data.token, body }
    } catch {
      /* fall through */
    }
  }
  if (res.status() === 429) {
    bumpStats({
      rateLimited429: (readContractAuthCache()?.stats.rateLimited429 ?? 0) + 1,
    })
  }
  return { ok: false, status: res.status(), body }
}

async function registerOnce(
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<{ status: number; body: string }> {
  bumpStats({ registerAttempts: (readContractAuthCache()?.stats.registerAttempts ?? 0) + 1 })
  const res = await request.post('/api/auth/register', {
    data: { email, password: TEST_PASSWORD, name },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  const body = await res.text()
  if (res.status() === 429) {
    bumpStats({
      rateLimited429: (readContractAuthCache()?.stats.rateLimited429 ?? 0) + 1,
    })
  }
  return { status: res.status(), body }
}

async function ensureAccountToken(
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<string> {
  const cached = memoryTokens.get(email)
  if (cached) {
    bumpStats({ cacheHits: (readContractAuthCache()?.stats.cacheHits ?? 0) + 1 })
    return cached
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    let login = await loginOnce(request, email)
    if (login.token) {
      memoryTokens.set(email, login.token)
      persistTokens()
      return login.token
    }

    if (login.status === 429) {
      await sleep(1500 * (attempt + 1))
      continue
    }

    if (login.status === 401 || login.status === 403) {
      const reg = await registerOnce(request, email, name)
      if (reg.status === 429) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      if (reg.status !== 409 && reg.status !== 200 && reg.status !== 201) {
        throw new Error(`Register failed for ${email}: ${reg.status} ${reg.body}`)
      }
      login = await loginOnce(request, email)
      if (login.token) {
        memoryTokens.set(email, login.token)
        persistTokens()
        return login.token
      }
      if (login.status === 429) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw new Error(`Login failed for ${email} after register: ${login.status} ${login.body}`)
    }

    throw new Error(`Login failed for ${email}: ${login.status} ${login.body}`)
  }
  throw new Error(`Login rate-limited for ${email} after retries`)
}

function persistTokens(): void {
  const disk = readContractAuthCache()
  writeContractAuthCache({
    tokens: Object.fromEntries(memoryTokens),
    stats: disk?.stats ?? {
      loginAttempts: 0,
      registerAttempts: 0,
      cacheHits: 0,
      rateLimited429: 0,
    },
  })
}

/** Pre-warm deterministic contract users (global-setup). */
export async function warmContractAuthCache(
  request: APIRequestContext,
  emails: string[],
): Promise<void> {
  const names: Record<string, string> = {
    [AUTH_EMAIL]: TEST_NAME,
    [SELLER_CONTRACT_EMAIL]: SELLER_NAME,
    [BUYER_CONTRACT_EMAIL]: BUYER_NAME,
  }
  for (const email of emails) {
    await ensureAccountToken(request, email, names[email] ?? email)
  }
}

export async function obtainAuthToken(request: APIRequestContext): Promise<string> {
  return ensureAccountToken(request, AUTH_EMAIL, TEST_NAME)
}

export async function obtainSellerContractToken(request: APIRequestContext): Promise<string> {
  return ensureAccountToken(request, SELLER_CONTRACT_EMAIL, SELLER_NAME)
}

export async function obtainBuyerContractToken(request: APIRequestContext): Promise<string> {
  return ensureAccountToken(request, BUYER_CONTRACT_EMAIL, BUYER_NAME)
}

export async function signInWithToken(
  page: Page,
  token: string,
  email: string = AUTH_EMAIL,
): Promise<void> {
  const profile = PROFILE_BY_EMAIL[email] ?? { name: email.split('@')[0], initials: 'U' }
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ t, em, name, initials }) => {
      window.localStorage.setItem('record-platform.token', t)
      window.localStorage.setItem(
        'record-platform.contract-profile',
        JSON.stringify({ name, email: em, initials, provider: 'local' }),
      )
    },
    { t: token, em: email, name: profile.name, initials: profile.initials },
  )
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
}

export async function signInAsTestCollector(page: Page): Promise<void> {
  await signInWithContractApiToken(page)
}

export async function signInAsTestCollectorWithSeed(
  page: Page,
): Promise<{ token: string; seed: MarketplaceSeedResult }> {
  const token = await signInWithContractApiToken(page)
  const seed = await ensureMarketplaceSeed(page.request, token)
  await page.evaluate((s) => {
    window.localStorage.setItem('record-platform.marketplace-seed', JSON.stringify(s))
  }, seed)
  return { token, seed }
}

export async function signInWithContractApiToken(page: Page): Promise<string> {
  const token = await obtainAuthToken(page.request)
  await signInWithToken(page, token, AUTH_EMAIL)
  return token
}

export async function signInWithBuyerContractApiToken(page: Page): Promise<string> {
  const token = await obtainBuyerContractToken(page.request)
  await signInWithToken(page, token, BUYER_CONTRACT_EMAIL)
  return token
}

export async function signInWithSellerContractApiToken(page: Page): Promise<string> {
  const token = await obtainSellerContractToken(page.request)
  await signInWithToken(page, token, SELLER_CONTRACT_EMAIL)
  return token
}

export function signedInUserPattern(): RegExp {
  return /Test Collector|Seller Contract|Buyer Contract|e2e[\s-]*contract/i
}

export async function expectSignedInUserVisible(page: Page, timeout = 12_000): Promise<void> {
  await expect(page.getByText(signedInUserPattern()).first()).toBeVisible({ timeout })
}

export async function signInAsTestCollectorViaUi(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  if (!page.url().includes('/login')) return
  await page.getByLabel(/email/i).fill(AUTH_EMAIL)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}
