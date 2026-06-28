import { execSync } from 'node:child_process'

import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithToken, AUTH_EMAIL } from './helpers/auth'
import { leakageCheck } from './helpers/ai-rag'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  buildSellerIntelAggregate,
  writeSellerIntelArtifacts,
  type SellerPanelLatency,
} from './helpers/seller-intelligence-ui'

test.describe.configure({ timeout: 180_000 })

const FORBIDDEN_UI =
  /message_body|thread_text|private obo message|proxy_bids|max_bid_cents/i

const SELLER_ENDPOINTS = [
  {
    panel_id: 'listing_advice',
    panel: 'Listing Advice',
    path: '/api/ai/seller/listing-advice',
    cardTestId: 'seller-listing-advice-card',
    readyTestId: 'seller-listing-advice-ready',
    summaryTestId: 'seller-listing-advice-summary',
  },
  {
    panel_id: 'negotiation_strategy',
    panel: 'Negotiation Strategy',
    path: '/api/ai/seller/negotiation-strategy',
    cardTestId: 'seller-negotiation-strategy-card',
    readyTestId: 'seller-negotiation-strategy-ready',
    summaryTestId: 'seller-negotiation-strategy-summary',
  },
  {
    panel_id: 'auction_pressure',
    panel: 'Auction Pressure',
    path: '/api/ai/seller/auction-pressure',
    cardTestId: 'seller-auction-pressure-card',
    readyTestId: 'seller-auction-pressure-ready',
    summaryTestId: 'seller-auction-pressure-summary',
  },
  {
    panel_id: 'collector_metadata_gaps',
    panel: 'Collector Metadata Gaps',
    path: '/api/ai/seller/collector-metadata-gaps',
    cardTestId: 'seller-collector-metadata-card',
    readyTestId: 'seller-collector-metadata-ready',
    summaryTestId: 'seller-collector-metadata-summary',
  },
] as const

function baselineSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function runTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

async function signInFreshContract(page: import('@playwright/test').Page): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { email: AUTH_EMAIL, password: 'ContractPass123!' },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  expect(res.ok(), `fresh login: ${await res.text()}`).toBeTruthy()
  const { token } = (await res.json()) as { token: string }
  await signInWithToken(page, token, AUTH_EMAIL)
}

function envelopeTemplate(body: Record<string, unknown>): string | null {
  const details = body.details as Record<string, unknown> | undefined
  const synthesis = details?.synthesis as Record<string, unknown> | undefined
  return typeof synthesis?.template === 'string'
    ? synthesis.template
    : typeof body.contract_id === 'string'
      ? body.contract_id
      : null
}

function refsCount(body: Record<string, unknown>): number {
  const refs = body.source_refs
  return Array.isArray(refs) ? refs.length : 0
}

test.describe('Seller intelligence UI (P21.1A / P21.2A / P21.6)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('Seller intelligence UI — four structured panels on /insights', async ({ page }) => {
    const timestamp = runTimestamp()
    const baseURL = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
    const requestStarted: Record<string, number> = {}
    const responses: Record<
      string,
      { status: number; ms: number; body: Record<string, unknown> }
    > = {}

    page.on('request', (req) => {
      const path = SELLER_ENDPOINTS.find((s) => req.url().includes(s.path))?.path
      if (!path || req.method() !== 'POST') return
      requestStarted[path] = Date.now()
    })

    page.on('response', async (res) => {
      const path = SELLER_ENDPOINTS.find((s) => res.url().includes(s.path))?.path
      if (!path || res.request().method() !== 'POST') return
      const started = requestStarted[path] ?? Date.now()
      const ms = Math.max(0, Date.now() - started)
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
    const pageReadyMs = Date.now() - t0

    await expect(page.getByTestId('seller-intelligence-panel')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('seller-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    const sellerDashboardReadyMs = Date.now() - t0

    const panelLatencies: SellerPanelLatency[] = []

    for (const spec of SELLER_ENDPOINTS) {
      const panelT0 = Date.now()
      await expect(page.getByTestId(spec.cardTestId)).toBeVisible({ timeout: 120_000 })
      await expect(page.getByTestId(spec.readyTestId)).toBeVisible({ timeout: 120_000 })
      const summary = page.getByTestId(spec.summaryTestId)
      await expect(summary).toBeVisible({ timeout: 120_000 })
      const uiReadyMs = Date.now() - t0
      const text = (await summary.textContent()) ?? ''
      expect(text.length).toBeGreaterThan(20)

      const resp = responses[spec.path]
      expect(resp, `missing response for ${spec.path}`).toBeTruthy()
      expect(resp.status).toBe(200)

      const leakage = leakageCheck(text, [])
      expect(leakage).toBe('PASS')

      panelLatencies.push({
        panel_id: spec.panel_id,
        panel_name: spec.panel,
        endpoint_path: spec.path,
        http_status: resp.status,
        api_ms: resp.ms,
        ui_ready_ms: uiReadyMs,
        summary_chars: text.length,
        refs_count: refsCount(resp.body),
        synthesis_template: envelopeTemplate(resp.body),
        leakage_result: leakage,
      })

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

      if (spec.path === '/api/ai/seller/collector-metadata-gaps') {
        await expect(card.getByTestId('collector-metadata-field-map')).toBeVisible({
          timeout: 30_000,
        })
        await expect(card.getByTestId('collector-metadata-completeness-score')).toBeVisible()
        await expect(card.getByTestId('collector-metadata-high-priority-missing')).toBeVisible()
        await expect(card.getByTestId('collector-metadata-recommended-edits')).toBeVisible()
        expect(await card.getByTestId('collector-metadata-field-row').count()).toBeGreaterThan(0)
      }

      void panelT0
    }

    const panel = page.getByTestId('seller-intelligence-panel')
    expect(await panel.getByTestId('ai-source-evidence-item').count()).toBeGreaterThan(0)

    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('ai-rag-summary')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('ai-insight-rag-ready')).toBeVisible({ timeout: 120_000 })
    const ragReadyMs = Date.now() - t0

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

    const session = {
      ticket: 'P21.6',
      baseline_sha: baselineSha(),
      run_timestamp: timestamp,
      base_url: baseURL,
      browser: 'chromium',
      login_user: AUTH_EMAIL,
      command:
        './scripts/webapp-playwright-strict-edge.sh e2e/seller-intelligence-ui.spec.ts --grep "Seller intelligence UI"',
      page_ready_ms: pageReadyMs,
      seller_dashboard_ready_ms: sellerDashboardReadyMs,
      rag_ready_ms: ragReadyMs,
      panels: panelLatencies,
      aggregate: buildSellerIntelAggregate(panelLatencies),
    }

    const paths = writeSellerIntelArtifacts(session, timestamp)

    console.log(`\nSeller intelligence UI — ${SELLER_ENDPOINTS.length}/4 panels · ${sellerDashboardReadyMs}ms seller-ready`)
    console.log(`JSON: ${paths.jsonPath}`)
    for (const spec of SELLER_ENDPOINTS) {
      const p = panelLatencies.find((x) => x.panel_id === spec.panel_id)
      console.log(
        `${spec.panel}: http=${p?.http_status ?? '?'} api=${p?.api_ms ?? 0}ms ui_ready=${p?.ui_ready_ms ?? 0}ms`,
      )
    }
    console.log(`RAG ready: ${ragReadyMs}ms · page ready: ${pageReadyMs}ms`)
  })
})
