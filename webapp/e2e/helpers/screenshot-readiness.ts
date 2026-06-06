import fs from 'node:fs'
import path from 'node:path'

import { expect, type Page } from '@playwright/test'

import { assertNoHeaderOverlayInPageContent } from './page-content-guard'

const LOADING_PATTERNS = [
  /Loading marketplace/i,
  /Loading listings/i,
  /Loading cart/i,
  /Loading feedback/i,
  /Loading records/i,
  /Loading collection/i,
  /Searching\.\.\./i,
]

const FORBIDDEN_CONTRACT_STRINGS = [
  /\bdemo\b/i,
  /\bmock\b/i,
  /\bfallback\b/i,
  /Provider:\s*dev/i,
  /\bOCH\b/,
  /\bHousing\b/,
  /off-campus/i,
  /DEMO_FEEDBACK/i,
  /\bapartment\b/i,
  /\blandlord\b/i,
  /\btenant\b/i,
  /\blease\b/i,
  /\brent\b/i,
  /Format:\s*apartment/i,
  /Listing not found/i,
  /Loading revision history/i,
  /Loading listing/i,
]

export async function waitForNoLoadingStates(page: Page, context = 'page'): Promise<void> {
  const body = await page.locator('body').innerText()
  for (const re of LOADING_PATTERNS) {
    expect(body, `${context} must not show ${re}`).not.toMatch(re)
  }
  const skeletonOnly =
    (await page.locator('[data-testid="record-card"]').count()) === 0 &&
    (await page.locator('.animate-pulse').count()) > 3
  expect(skeletonOnly, `${context} must not be skeleton-only`).toBeFalsy()
}

export async function assertNoForbiddenContractStrings(
  page: Page,
  context = 'screenshot',
): Promise<void> {
  const body = await page.locator('body').innerText()
  for (const re of FORBIDDEN_CONTRACT_STRINGS) {
    expect(body, `${context} must not contain ${re}`).not.toMatch(re)
  }
}

/** Active contract run date (YYYY-MM-DD). Set CONTRACT_SCREENSHOT_DATE in CI/Makefile. */
export function contractScreenshotDate(): string {
  const env = process.env.CONTRACT_SCREENSHOT_DATE?.trim()
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env
  return new Date().toISOString().slice(0, 10)
}

/** Dated contract screenshot path under authenticated/YYYY-MM-DD/. */
export function contractScreenshotPath(filename: string): string {
  return `e2e/screenshots/authenticated/${contractScreenshotDate()}/${filename}`
}

/** Guest contract screenshots under guest/YYYY-MM-DD/. */
export function guestContractScreenshotPath(filename: string): string {
  return `e2e/screenshots/guest/${contractScreenshotDate()}/${filename}`
}

export async function captureScreenshot(
  page: Page,
  filePath: string,
  opts?: { fullPage?: boolean; scope?: 'page-content' },
): Promise<void> {
  await waitForNoLoadingStates(page, filePath)
  await assertNoForbiddenContractStrings(page, filePath)
  await assertNoHeaderOverlayInPageContent(page)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (opts?.scope === 'page-content') {
    const content = page.getByTestId('page-content')
    await content.screenshot({ path: filePath })
    return
  }
  await page.screenshot({ path: filePath, fullPage: opts?.fullPage ?? false })
}

export async function capturePageContentScreenshot(page: Page, filePath: string): Promise<void> {
  await captureScreenshot(page, filePath, { scope: 'page-content' })
}

async function waitForRecordsShell(
  page: Page,
  view: 'grid' | 'list' | 'compact',
  minCount = 1,
): Promise<void> {
  const sel = view === 'list' ? '[data-testid="record-row"]' : '[data-testid="record-card"]'
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.goto(`/records?view=${view}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const rows = page.locator(sel)
    if ((await rows.count()) >= minCount) {
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      await waitForNoLoadingStates(page, `/records?view=${view}`)
      return
    }
    const retry = page.getByRole('button', { name: /^Retry$/i })
    if (await retry.isVisible().catch(() => false)) {
      await retry.click()
      if ((await rows.count()) >= minCount) {
        await expect(rows.first()).toBeVisible({ timeout: 20_000 })
        await waitForNoLoadingStates(page, `/records?view=${view}`)
        return
      }
    }
    await page.waitForTimeout(1200 * (attempt + 1))
  }
  const rows = page.locator(sel)
  expect(await rows.count(), 'records must load for contract screenshots').toBeGreaterThanOrEqual(
    minCount,
  )
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })
  await waitForNoLoadingStates(page, `/records?view=${view}`)
}

export async function waitForRecordsReady(
  page: Page,
  view: 'grid' | 'list' | 'compact',
  token?: string,
): Promise<void> {
  if (token) {
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/records', {
          headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
        })
        if (!res.ok()) return 0
        const rows = (await res.json()) as unknown[]
        return rows.length
      }, { timeout: 60_000 })
      .toBeGreaterThan(0)

    const sel = view === 'list' ? '[data-testid="record-row"]' : '[data-testid="record-card"]'
    await page.goto(`/records?view=${view}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.getByPlaceholder(/Search artist/i).fill('Kenny Dorham')
    const searchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/records') && r.request().method() === 'GET' && r.ok(),
      { timeout: 45_000 },
    )
    await page.getByRole('button', { name: /^Search$/ }).click()
    await searchResponse
    await expect(page.locator(sel).filter({ hasText: 'Kenny Dorham' }).first()).toBeVisible({
      timeout: 45_000,
    })
    await waitForNoLoadingStates(page, `/records?view=${view}`)
    return
  }
  await waitForRecordsShell(page, view, 1)
}

export async function waitForListingsReady(page: Page, view: 'grid' | 'list' | 'compact'): Promise<void> {
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/listings/search?limit=3')
      if (!res.ok()) return 0
      const body = (await res.json()) as { items?: unknown[] }
      return (body.items ?? []).length
    }, { timeout: 60_000 })
    .toBeGreaterThan(0)

  const sel =
    view === 'list' ? '[data-testid="listing-row"]' : '[data-testid="listing-card"]'
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.goto(`/listings`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const retry = page.getByRole('button', { name: /^Retry$/i })
    if (await retry.isVisible().catch(() => false)) {
      await retry.click()
      await page.waitForTimeout(2500)
    }
    if (view !== 'grid') {
      await page.locator('button').filter({ hasText: new RegExp(`^${view}$`, 'i') }).first().click()
    }
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 30_000 }).catch(() => {})
    if ((await page.locator(sel).count()) >= 1) {
      await expect(page.locator(sel).first()).toBeVisible({ timeout: 20_000 })
      await waitForNoLoadingStates(page, '/listings')
      return
    }
    await page.waitForTimeout(1500 * (attempt + 1))
  }
  await expect(page.locator(sel).first()).toBeVisible({ timeout: 30_000 })
  await waitForNoLoadingStates(page, '/listings')
}

export async function waitForFeedbackReady(page: Page, token?: string): Promise<void> {
  if (token) {
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/feedback/me', {
            headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
          })
          if (!res.ok()) return 0
          const data = (await res.json()) as { totalReviews?: number }
          return data.totalReviews ?? 0
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0)
  }
  await page.goto('/profile/feedback')
  await expect(page.locator('[data-testid="feedback-page-ready"]')).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('[data-testid="feedback-chart"]')).toBeVisible({ timeout: 30_000 })
  await waitForNoLoadingStates(page, '/profile/feedback')
}

export async function waitForSellingReady(page: Page, tab = 'active'): Promise<void> {
  await page.goto(`/profile/selling?status=${tab}`)
  await expect(page.locator('[data-testid="selling-page-ready"]')).toBeVisible({ timeout: 30_000 })
  const row = page.locator('[data-testid="selling-listing-row"]')
  const empty = page.locator('[data-testid="selling-empty-state-ready"]')
  await expect(row.first().or(empty)).toBeVisible({ timeout: 15_000 })
  await waitForNoLoadingStates(page, `/profile/selling?status=${tab}`)
}

/** Wait for a specific watchlist product card after API persistence is confirmed. */
export async function waitForWatchlistCard(
  page: Page,
  listingIdOrTitle: string,
  timeoutMs = 60_000,
): Promise<void> {
  await expect(page.getByTestId('watchlist-page-ready')).toBeVisible({ timeout: timeoutMs })
  const isListingId = /^[0-9a-f-]{36}$/i.test(listingIdOrTitle)
  const card = isListingId
    ? page
        .locator(`[data-testid="watchlist-item"] a[href="/listings/${listingIdOrTitle}"]`)
        .first()
    : page.locator('[data-testid="watchlist-item"]').filter({ hasText: listingIdOrTitle }).first()
  await expect(card).toBeVisible({ timeout: timeoutMs })
  await expect(page.locator('[data-testid="watchlist-item"]').first()).toBeVisible({
    timeout: timeoutMs,
  })
}
