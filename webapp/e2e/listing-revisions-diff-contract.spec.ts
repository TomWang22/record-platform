import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  createListingWithShipping,
  dumpListingContractDebug,
  patchListingAmenitiesMerge,
  patchListingFields,
  waitForListingRevisions,
} from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

let listingId = ''

async function latestRevisionText(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  newestMatches?: RegExp,
): Promise<string> {
  const token = await obtainAuthToken(request)
  await waitForListingRevisions(request, token, listingId, {
    minCount: 1,
    newestMatches,
  })
  await page.goto(`/listings/${listingId}/revisions`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
  const lines = page.locator('[data-testid="listing-revision-lines"]')
  await expect(lines.first()).toBeVisible({ timeout: 45_000 })
  return lines.first().innerText()
}

test.describe.serial('Listing revision diff correctness (7.6R)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    listingId = await timed('listing', () => createListingWithShipping(ctx.request, token))
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('title-only revision', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await patchListingFields(request, token, listingId, {
      title: `E2E Title Only ${Date.now()}`,
    })
    const text = await latestRevisionText(page, request)
    expect(text).toMatch(/Title:/)
    expect(text).not.toMatch(/Price:/)
    expect(text).not.toMatch(/Domestic shipping:/)
    expect(text).not.toMatch(/ → —/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-title-only.png'),
    )
  })

  test('price-only revision', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await patchListingFields(request, token, listingId, { price_cents: 4999 })
    const text = await latestRevisionText(page, request)
    expect(text).toMatch(/Price:/)
    expect(text).not.toMatch(/Title:/)
    expect(text).not.toMatch(/Domestic shipping:/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-price-only.png'),
    )
  })

  test('shipping-only revision', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await patchListingAmenitiesMerge(request, token, listingId, [
      'domestic_shipping_cents:700',
      'shipping_service:Ground Advantage',
    ])
    const text = await latestRevisionText(
      page,
      request,
      /domestic_shipping|shipping_service/i,
    )
    expect(text).toMatch(/Domestic shipping:|Shipping service:/)
    expect(text).not.toMatch(/Price:/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-shipping-only.png'),
    )
  })

  test('OBO-only revision', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await patchListingAmenitiesMerge(
      request,
      token,
      listingId,
      ['sale_type:obo', 'max_offer_attempts:5', 'offer_expiration_hours:48'],
      { pricing_mode: 'obo' },
    )
    const text = await latestRevisionText(page, request)
    expect(text).toMatch(/Sale type:|Max offer attempts:/)
    expect(text).toMatch(/Offer expiration/)
    expect(text).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec.*attempts/i)
    expect(text).not.toMatch(/Max offer attempts:.*\d{1,2}:\d{2}/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-obo-only.png'),
    )
  })

  test('auction-only revision', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const starts = new Date(Date.now() + 86_400_000).toISOString()
    const ends = new Date(Date.now() + 604_800_000).toISOString()
    await patchListingAmenitiesMerge(
      request,
      token,
      listingId,
      [
        'sale_type:auction',
        `auction_starts_at:${starts}`,
        `auction_ends_at:${ends}`,
        'starting_bid_cents:1000',
        'reserve_price_cents:5000',
      ],
      { pricing_mode: 'auction' },
    )
    const text = await latestRevisionText(page, request)
    expect(text).toMatch(/Sale type:|Auction start|Auction end|Starting bid|Reserve/)
    expect(text).not.toMatch(/Title:/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-auction-only.png'),
    )
  })

  test.afterEach(async ({ request }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const token = await obtainAuthToken(request).catch(() => '')
      if (token && listingId) {
        await dumpListingContractDebug(request, token, listingId, testInfo.title)
      }
    }
  })

  test('detail revision panel clean', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await waitForListingRevisions(request, token, listingId, { minCount: 1 })
    await page.goto(`/listings/${listingId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 90_000 })
    const revRes = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        res.url().includes(`/api/listings/${listingId}/revisions`) &&
        res.status() < 400,
      { timeout: 60_000 },
    )
    await page.getByTestId('listing-revision-panel').getByRole('button').click()
    await revRes
    await expect(page.getByTestId('listing-revision-panel-loaded')).toBeVisible({
      timeout: 60_000,
    })
    const panel = await page.getByTestId('listing-revision-panel-loaded').innerText()
    expect(panel).not.toMatch(/ → —/)
    expect(panel).not.toMatch(/"to"/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-revision-panel-clean.png'),
    )
  })
})
