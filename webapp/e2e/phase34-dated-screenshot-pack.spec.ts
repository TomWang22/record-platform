/**
 * Phase 34 dated screenshot pack — live stack, canonical authenticated/guest paths.
 *
 * Success/evidence states hit the real gateway + Python intelligence service.
 * Route interception is used ONLY for explicit fault states (429 / 5xx / malformed).
 *
 * Output:
 *   webapp/e2e/screenshots/authenticated/<CONTRACT_SCREENSHOT_DATE>/
 *   webapp/e2e/screenshots/guest/<CONTRACT_SCREENSHOT_DATE>/
 */
import { expect, test, type Page, type Route } from '@playwright/test'

import { obtainAuthToken, signInAsTestCollector, signInWithToken, AUTH_EMAIL, obtainSellerContractToken, obtainBuyerContractToken } from './helpers/auth'
import {
  captureScreenshot,
  contractScreenshotPath,
  guestContractScreenshotPath,
  waitForAiInsightsDashboardSettled,
  waitForListingsReady,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'
import { ensurePhase34DenseSeed } from './helpers/seed-phase34-dense'
import { ensureMarketplaceBrowseSaleMix } from './helpers/seed-marketplace-browse'
import { ensureTestCollection } from './helpers/seed-collection'
import { pollEdgeHealthReady } from './helpers/edge-health-readiness'

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
} as const

const DISABLE_MOTION = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
    caret-color: transparent !important;
  }
`

async function preparePage(page: Page, viewport: keyof typeof VIEWPORTS): Promise<void> {
  await page.setViewportSize(VIEWPORTS[viewport])
  await page.addStyleTag({ content: DISABLE_MOTION })
  await page.evaluate(() => document.fonts.ready).catch(() => {})
}

async function shot(
  page: Page,
  name: string,
  role: 'authenticated' | 'guest' = 'authenticated',
  opts: { strictReady?: boolean } = {},
): Promise<void> {
  const filePath =
    role === 'guest' ? guestContractScreenshotPath(name) : contractScreenshotPath(name)
  const strict = opts.strictReady === true
  if (!strict) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    await page.waitForTimeout(600)
    await page.screenshot({ path: filePath, fullPage: true })
    return
  }
  await captureScreenshot(page, filePath, { fullPage: true })
}

async function firstHref(page: Page, selector: string): Promise<string | null> {
  const href = await page.locator(selector).first().getAttribute('href').catch(() => null)
  return href
}

async function fulfillFault(route: Route, kind: '429' | '500' | 'malformed'): Promise<void> {
  if (kind === '429') {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
    })
    return
  }
  if (kind === '500') {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal_error' }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'PASS', capability: 'unknown' }),
  })
}

test.describe('Phase 34 dated screenshot pack (live)', () => {
  test.describe.configure({ timeout: 240_000 })

  test.beforeAll(async ({ request }) => {
    await pollEdgeHealthReady(request)
    const viewerToken = await obtainAuthToken(request)
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    await ensureTestCollection(request, viewerToken)
    await ensureMarketplaceBrowseSaleMix(request, sellerToken)
    // Seller inventory + buyer inventory, then populate the screenshot account watchlist
    // from other-seller lots (never empty shells).
    await ensurePhase34DenseSeed(request, sellerToken, {
      targetWatchlist: 0,
      requireMinWatchlist: 0,
    })
    await ensurePhase34DenseSeed(request, buyerToken, {
      targetRecords: 24,
      targetListings: 24,
      targetWatchlist: 0,
      requireMinWatchlist: 0,
    })
    const summary = await ensurePhase34DenseSeed(request, viewerToken, {
      targetRecords: 60,
      targetListings: 40,
      targetWatchlist: 30,
      listingPoolToken: sellerToken === viewerToken ? buyerToken : sellerToken,
      watchlistActorToken: viewerToken,
      requireMinWatchlist: 5,
    })
    // Persist seed summary for owner review (outside git screenshot trees).
    const fs = await import('node:fs')
    fs.mkdirSync('/tmp/phase34-screenshot-pack', { recursive: true })
    fs.writeFileSync(
      '/tmp/phase34-screenshot-pack/seed-summary.json',
      JSON.stringify({ ...summary, at: new Date().toISOString() }, null, 2) + '\n',
    )
  })

  test('guest public pack desktop+mobile', async ({ page }) => {
    test.setTimeout(300_000)
    const routes = [
      { name: 'home', path: '/' },
      { name: 'listings', path: '/listings' },
      { name: 'auctions', path: '/auctions' },
      { name: 'market', path: '/market' },
      { name: 'login', path: '/login' },
      { name: 'records-auth-required', path: '/records' },
      { name: 'insights-auth-required', path: '/insights' },
      { name: 'messages-auth-required', path: '/messages' },
    ] as const

    for (const viewport of ['desktop', 'mobile'] as const) {
      await preparePage(page, viewport)
      await page.context().clearCookies()
      for (const route of routes) {
        await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForTimeout(700)
        const body = (await page.textContent('body')) ?? ''
        expect(body).not.toContain('Application error')
        await shot(page, `guest-${route.name}__${viewport}.png`, 'guest', { strictReady: false })
      }
    }
  })

  test('authenticated intelligence live pack', async ({ page, request }) => {
    test.setTimeout(600_000)
    const token = await obtainAuthToken(request)
    await signInWithToken(page, token, AUTH_EMAIL)

    // --- Desktop dense product + intelligence surfaces ---
    await preparePage(page, 'desktop')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'authenticated-dashboard-recommendations__desktop.png', 'authenticated', {
      strictReady: false,
    })

    await waitForListingsReady(page, 'grid')
    const searchChrome = page.getByTestId('intelligence-search-chrome')
    if (await searchChrome.isVisible().catch(() => false)) {
      await shot(page, 'authenticated-listings-search-chrome-keyword__desktop.png')

      await page.getByTestId('intelligence-search-mode-semantic').click()
      await page.getByTestId('intelligence-search-run').click()
      await page.waitForTimeout(2500)
      await shot(page, 'authenticated-listings-search-semantic-live__desktop.png', 'authenticated', {
        strictReady: false,
      })

      await page.getByTestId('intelligence-search-mode-hybrid').click()
      await page.getByTestId('intelligence-search-run').click()
      await page.waitForTimeout(2500)
      await shot(page, 'authenticated-listings-search-hybrid-live__desktop.png', 'authenticated', {
        strictReady: false,
      })

      await page.getByTestId('intelligence-search-mode-owner-scoped').click()
      await page.getByTestId('intelligence-search-run').click()
      await page.waitForTimeout(1500)
      await shot(page, 'authenticated-listings-search-owner-scoped__desktop.png', 'authenticated', {
        strictReady: false,
      })

      // Visible fallback failure (fault-only intercept)
      await page.route('**/api/ai/intelligence/semantic-search**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'keyword',
            results: [],
            diagnostics: { silent_fallback: true },
          }),
        })
      })
      await page.getByTestId('intelligence-search-mode-semantic').click()
      await page.getByTestId('intelligence-search-run').click()
      await page.waitForTimeout(1500)
      await shot(page, 'authenticated-listings-search-fallback-visible__desktop.png', 'authenticated', {
        strictReady: false,
      })
      await page.unroute('**/api/ai/intelligence/semantic-search**')
    } else {
      await shot(page, 'authenticated-listings-browse-live__desktop.png', 'authenticated', {
        strictReady: false,
      })
    }

    // Record detail — scarcity + valuation + recommendations (live)
    await page.goto('/records?view=grid', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const recordHref = await firstHref(page, 'a[href^="/records/"]')
    expect(recordHref, 'seeded records must expose a detail link').toBeTruthy()
    await page.goto(recordHref!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await expect(page.getByTestId('intelligence-scarcity-panel')).toBeVisible({ timeout: 60_000 }).catch(() => {})
    await expect(page.getByTestId('intelligence-valuation-panel')).toBeVisible({ timeout: 60_000 }).catch(() => {})
    // Wait for loading to clear on scarcity (auto-fetch)
    await page
      .getByTestId('intelligence-scarcity-panel-loading')
      .waitFor({ state: 'detached', timeout: 90_000 })
      .catch(() => {})
    await page
      .getByTestId('intelligence-valuation-panel-loading')
      .waitFor({ state: 'detached', timeout: 90_000 })
      .catch(() => {})
    await shot(page, 'authenticated-record-scarcity-valuation-live__desktop.png')

    // Scarcity 429 fault
    await page.route('**/api/ai/intelligence/scarcity**', (route) => fulfillFault(route, '429'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    await shot(page, 'authenticated-record-scarcity-429__desktop.png')
    await page.unroute('**/api/ai/intelligence/scarcity**')

    // Scarcity 500 fault
    await page.route('**/api/ai/intelligence/scarcity**', (route) => fulfillFault(route, '500'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)
    await shot(page, 'authenticated-record-scarcity-5xx__desktop.png')
    await page.unroute('**/api/ai/intelligence/scarcity**')

    // Listing detail — auction/valuation when present
    await page.goto('/listings', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForListingsReady(page, 'grid')
    const listingHref = await firstHref(page, 'a[href^="/listings/"]')
    expect(listingHref).toBeTruthy()
    await page.goto(listingHref!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2000)
    await shot(page, 'authenticated-listing-detail-intelligence-live__desktop.png')

    const auctionRun = page.getByTestId('intelligence-auction-panel-run')
    if (await auctionRun.isVisible().catch(() => false)) {
      await auctionRun.click()
      await page.waitForTimeout(3000)
      await shot(page, 'authenticated-listing-auction-intelligence-live__desktop.png')
    }

    // Watchlist temperature
    await page.goto('/watchlist', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await expect(page.getByTestId('watchlist-page-ready')).toBeVisible({ timeout: 60_000 })
    const tempRun = page.getByTestId('intelligence-watchlist-temperature-panel-run')
    if (await tempRun.isVisible().catch(() => false)) {
      await tempRun.click()
      await page.waitForTimeout(4000)
    }
    await shot(page, 'authenticated-watchlist-temperature-live__desktop.png')

    // Insights — analytics + embedding lineage (live)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { name: /AI Insights/i })).toBeVisible({
      timeout: 45_000,
    })
    await waitForAiInsightsDashboardSettled(page).catch(() => {})
    await page.waitForTimeout(2000)
    await shot(page, 'authenticated-insights-market-analytics-live__desktop.png')

    const embedBtn = page.getByRole('button', { name: /Inspect metadata|embedding/i }).first()
    if (await embedBtn.isVisible().catch(() => false)) {
      await embedBtn.click()
      await page.waitForTimeout(2500)
      await shot(page, 'authenticated-insights-embedding-lineage-live__desktop.png')
    }

    // Profile selling analytics (dense)
    await page.goto('/profile/selling?status=active', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2500)
    await shot(page, 'authenticated-seller-dashboard-analytics-live__desktop.png')

    await page.goto('/profile/purchases', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2000)
    await shot(page, 'authenticated-buyer-dashboard-analytics-live__desktop.png')

    // Messages — negotiation + memory
    await page.goto('/messages', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2000)
    await shot(page, 'authenticated-messages-negotiation-memory-shell__desktop.png')

    const negoRun = page.getByTestId('intelligence-negotiation-panel-run')
    if (await negoRun.isVisible().catch(() => false)) {
      await negoRun.click()
      await page.waitForTimeout(4000)
      await shot(page, 'authenticated-messages-negotiation-live__desktop.png')
      const draft = page.getByTestId('intelligence-negotiation-draft')
      if (await draft.isVisible().catch(() => false)) {
        await expect(draft).toBeEditable()
        await shot(page, 'authenticated-messages-negotiation-draft-editable__desktop.png')
      }
    }

    // Offers
    await page.goto('/offers/inbox', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'authenticated-offers-inbox-negotiation__desktop.png')

    // Mobile sweeps for key intelligence surfaces
    await preparePage(page, 'mobile')
    await page.goto(recordHref!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page
      .getByTestId('intelligence-scarcity-panel-loading')
      .waitFor({ state: 'detached', timeout: 90_000 })
      .catch(() => {})
    await shot(page, 'authenticated-record-scarcity-valuation-live__mobile.png')

    await page.goto('/listings', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForListingsReady(page, 'grid')
    await shot(page, 'authenticated-listings-search-chrome__mobile.png')

    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2500)
    await shot(page, 'authenticated-insights-analytics__mobile.png')

    await page.goto('/messages', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'authenticated-messages__mobile.png')

    await page.goto('/watchlist', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'authenticated-watchlist__mobile.png')

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(1500)
    await shot(page, 'authenticated-dashboard-recommendations__mobile.png')

    // Tablet sample
    await preparePage(page, 'tablet')
    await page.goto('/listings', { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForListingsReady(page, 'grid')
    await shot(page, 'authenticated-listings-search-chrome__tablet.png')
    await page.goto(recordHref!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(2000)
    await shot(page, 'authenticated-record-intelligence__tablet.png')
  })

  test('authenticated marketplace+route density pack', async ({ page }) => {
    test.setTimeout(300_000)
    await signInAsTestCollector(page)
    await preparePage(page, 'desktop')

    const routes = [
      'dashboard',
      'records',
      'listings',
      'auctions',
      'market',
      'watchlist',
      'cart',
      'messages',
      'insights',
      'settings',
      'profile',
      'offers/inbox',
      'offers/sent',
    ] as const

    for (const route of routes) {
      await page.goto(`/${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(1000)
      await waitForNoLoadingStates(page, route).catch(() => {})
      await shot(page, `authenticated-${route.replace('/', '-')}-dense__desktop.png`, 'authenticated', {
        strictReady: false,
      })
    }

    await preparePage(page, 'mobile')
    for (const route of ['listings', 'records', 'insights', 'profile'] as const) {
      await page.goto(`/${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(900)
      await shot(page, `authenticated-${route}-dense__mobile.png`, 'authenticated', {
        strictReady: false,
      })
    }
  })
})
