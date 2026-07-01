import { test, expect } from '@playwright/test'

import { signInWithToken } from './helpers/auth'
import { leakageCheck } from './helpers/ai-rag'

test.describe.configure({ timeout: 180_000 })

const COHORT_EMAIL = 't20-15g-cohort0@record-platform.local'
const CONTRACT_EMAIL = 'e2e-contract@record-platform.local'
const PASSWORD = 'ContractPass123!'
const FORBIDDEN_UI =
  /message_body|thread_text|private obo message|proxy_bids|max_bid_cents|production default enabled|vector default|percentage rollout/i
const RAG_QUESTION = 'Which of my listings need attention first, and why?'

async function loginAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { email, password: PASSWORD },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  expect(res.ok(), `login ${email}: ${await res.text()}`).toBeTruthy()
  const { token } = (await res.json()) as { token: string }
  await signInWithToken(page, token, email)
}

async function ragGateFromPage(page: import('@playwright/test').Page): Promise<string | null> {
  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().includes('/api/ai/rag/query') &&
      res.request().method() === 'POST' &&
      res.status() === 200,
    { timeout: 120_000 },
  )
  await page.getByTestId('ai-rag-question-input').fill(RAG_QUESTION)
  await page.getByTestId('ai-insight-rag').getByRole('button', { name: 'Query' }).click()
  const response = await responsePromise
  const body = (await response.json()) as {
    details?: { retrieval_mode?: string; hybrid_canary?: { gate_reason?: string } }
    summary?: string
  }
  const leakage = leakageCheck(body.summary ?? '', [])
  expect(leakage).toBe('PASS')
  return body.details?.hybrid_canary?.gate_reason ?? null
}

test.describe('Opt-in hybrid preview UI (T20.27)', () => {
  test('cohort user — enroll, preview_opt_in RAG, revoke to keyword_default', async ({ page }) => {
    await loginAs(page, COHORT_EMAIL)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('heading', { name: 'Hybrid preview (opt-in)' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('ai-hybrid-preview-not-enrolled')).toBeVisible({ timeout: 60_000 })

    const cardText = await page.getByTestId('ai-hybrid-preview-card').innerText()
    expect(FORBIDDEN_UI.test(cardText)).toBe(false)
    expect(cardText).toContain('Hybrid preview is opt-in; keyword remains default.')

    await page.getByTestId('ai-hybrid-preview-enroll-btn').click()
    await page.getByTestId('ai-hybrid-preview-confirm-enroll').click()
    await expect(page.getByTestId('ai-hybrid-preview-enrolled')).toBeVisible({ timeout: 30_000 })

    const gateEnrolled = await ragGateFromPage(page)
    expect(gateEnrolled).toBe('preview_opt_in')

    await page.getByTestId('ai-hybrid-preview-revoke-btn').click()
    await page.getByTestId('ai-hybrid-preview-confirm-revoke').click()
    await expect(page.getByTestId('ai-hybrid-preview-not-enrolled')).toBeVisible({ timeout: 30_000 })

    const gateRevoked = await ragGateFromPage(page)
    expect(gateRevoked).toBe('keyword_default')
  })

  test('contract allowlist user — informational state, allowlist gate', async ({ page }) => {
    await loginAs(page, CONTRACT_EMAIL)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('heading', { name: 'Hybrid preview (opt-in)' })).toBeVisible({
      timeout: 30_000,
    })

    const gate = await ragGateFromPage(page)
    expect(gate).toBe('allowlist')
    await expect(page.getByTestId('ai-hybrid-preview-allowlist-info')).toBeVisible({ timeout: 60_000 })

    const cardText = await page.getByTestId('ai-hybrid-preview-card').innerText()
    expect(FORBIDDEN_UI.test(cardText)).toBe(false)
  })

  test('guest — no preview card on insights', async ({ page }) => {
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-hybrid-preview-card')).toHaveCount(0)
  })
})

test.describe('Opt-in hybrid preview API contract', () => {
  test('preview status endpoint returns structured payload', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { email: COHORT_EMAIL, password: PASSWORD },
      headers: { 'X-RP-E2E-Contract': '1' },
    })
    expect(login.ok()).toBeTruthy()
    const { token } = (await login.json()) as { token: string }
    const res = await request.get('/api/ai/rag/preview/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { enrolled?: boolean; gate_reason?: string }
    expect(typeof body.enrolled).toBe('boolean')
    expect(body).toHaveProperty('gate_reason')
  })
})
