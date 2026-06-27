import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithToken, AUTH_EMAIL } from './helpers/auth'
import { leakageCheck } from './helpers/ai-rag'
import { ensureTestCollection } from './helpers/seed-collection'

test.describe.configure({ timeout: 180_000 })

const FORBIDDEN_UI =
  /message_body|thread_text|private obo message|proxy_bids|max_bid_cents/i

const SELLER_ENDPOINTS = [
  {
    panel: 'Listing Advice',
    path: '/api/ai/seller/listing-advice',
    cardTestId: 'seller-listing-advice-card',
    readyTestId: 'seller-listing-advice-ready',
    summaryTestId: 'seller-listing-advice-summary',
  },
  {
    panel: 'Negotiation Strategy',
    path: '/api/ai/seller/negotiation-strategy',
    cardTestId: 'seller-negotiation-strategy-card',
    readyTestId: 'seller-negotiation-strategy-ready',
    summaryTestId: 'seller-negotiation-strategy-summary',
  },
  {
    panel: 'Auction Pressure',
    path: '/api/ai/seller/auction-pressure',
    cardTestId: 'seller-auction-pressure-card',
    readyTestId: 'seller-auction-pressure-ready',
    summaryTestId: 'seller-auction-pressure-summary',
  },
  {
    panel: 'Collector Metadata Gaps',
    path: '/api/ai/seller/collector-metadata-gaps',
    cardTestId: 'seller-collector-metadata-card',
    readyTestId: 'seller-collector-metadata-ready',
    summaryTestId: 'seller-collector-metadata-summary',
  },
] as const

async function signInFreshContract(page: import('@playwright/test').Page): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { email: AUTH_EMAIL, password: 'ContractPass123!' },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  expect(res.ok(), `fresh login: ${await res.text()}`).toBeTruthy()
  const { token } = (await res.json()) as { token: string }
  await signInWithToken(page, token, AUTH_EMAIL)
}

test.describe('Seller intelligence UI (P21.1A / P21.2A)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('Seller intelligence UI — four structured panels on /insights', async ({ page }) => {
    const responses: Record<
      string,
      { status: number; ms: number; body: Record<string, unknown> }
    > = {}

    page.on('response', async (res) => {
      const path = SELLER_ENDPOINTS.find((s) => res.url().includes(s.path))?.path
      if (!path || res.request().method() !== 'POST') return
      const timing = res.request().timing()
      const ms = timing.responseEnd > 0 ? timing.responseEnd : 0
      try {
        const body = (await res.json()) as Record<string, unknown>
        responses[path] = { status: res.status(), ms, body }
      } catch {
        responses[path] = { status: res.status(), ms, body: {} }
      }
    })

    await signInFreshContract(page)
    const t0 = Date.now()
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('seller-intelligence-panel')).toBeVisible({ timeout: 120_000 })

    for (const spec of SELLER_ENDPOINTS) {
      await expect(page.getByTestId(spec.cardTestId)).toBeVisible({ timeout: 120_000 })
      await expect(page.getByTestId(spec.readyTestId)).toBeVisible({ timeout: 120_000 })
      const summary = page.getByTestId(spec.summaryTestId)
      await expect(summary).toBeVisible({ timeout: 120_000 })
      const text = (await summary.textContent()) ?? ''
      expect(text.length).toBeGreaterThan(20)

      const resp = responses[spec.path]
      expect(resp, `missing response for ${spec.path}`).toBeTruthy()
      expect(resp.status).toBe(200)

      const leakage = leakageCheck(text, [])
      expect(leakage).toBe('PASS')

      const card = page.getByTestId(spec.cardTestId)
      const evidenceItems = card.getByTestId('ai-source-evidence-item')
      await expect(evidenceItems.first()).toBeVisible({ timeout: 30_000 })
      expect(await evidenceItems.count()).toBeGreaterThan(0)

      const toggle = evidenceItems.first().getByTestId('ai-source-evidence-toggle')
      await toggle.click()

      const excerpt = evidenceItems.first().getByTestId('seller-intelligence-source-excerpt')
      const unavailable = evidenceItems.first().getByTestId('ai-source-evidence-unavailable')
      const excerptVisible = await excerpt.isVisible().catch(() => false)
      const unavailableVisible = await unavailable.isVisible().catch(() => false)
      expect(excerptVisible || unavailableVisible).toBe(true)

      const expandedText =
        (await excerpt.textContent().catch(() => '')) ||
        (await unavailable.textContent().catch(() => '')) ||
        ''
      expect(expandedText).not.toMatch(FORBIDDEN_UI)
    }

    const panel = page.getByTestId('seller-intelligence-panel')
    expect(await panel.getByTestId('ai-source-evidence-item').count()).toBeGreaterThan(0)

    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('ai-rag-summary')).toBeVisible()
    await expect(page.getByTestId('ai-insight-rag-ready')).toBeVisible()

    const ragCard = page.getByTestId('ai-insight-rag')
    const ragToggle = ragCard.getByTestId('ai-source-evidence-toggle').first()
    await expect(ragToggle).toBeVisible({ timeout: 30_000 })
    await ragToggle.click()
    const ragExcerpt = ragCard.getByTestId('ai-source-evidence-excerpt')
    const ragUnavailable = ragCard.getByTestId('ai-source-evidence-unavailable')
    const ragExcerptOk = await ragExcerpt.isVisible().catch(() => false)
    const ragUnavailableOk = await ragUnavailable.isVisible().catch(() => false)
    expect(ragExcerptOk || ragUnavailableOk).toBe(true)

    const ragText = (await page.getByTestId('ai-rag-summary').textContent()) ?? ''
    expect(leakageCheck(ragText, [])).toBe('PASS')
    expect(ragText.length).toBeGreaterThan(20)
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(FORBIDDEN_UI)

    const elapsed = Date.now() - t0
    console.log(`\nSeller intelligence UI — ${SELLER_ENDPOINTS.length}/4 panels · ${elapsed}ms total`)
    for (const spec of SELLER_ENDPOINTS) {
      const r = responses[spec.path]
      const summaryEl = page.getByTestId(spec.summaryTestId)
      const chars = ((await summaryEl.textContent()) ?? '').length
      console.log(
        `${spec.panel}: http=${r?.status ?? '?'} ms=${Math.round(r?.ms ?? 0)} summary=${chars}chars`,
      )
    }
  })
})
