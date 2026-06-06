import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  createListingWithShipping,
  fetchListingApi,
  patchListingFields,
} from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Listing sale mode persistence (7.5S)', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    listingId = await timed('listing', () => createListingWithShipping(ctx.request, token))
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('fixed → OBO → auction with API and UI proof', async ({ page, request }) => {
    const token = await obtainAuthToken(request)

    let api = await fetchListingApi(request, token, listingId)
    expect(api.saleType ?? api.pricing_mode).toMatch(/fixed/i)

    await patchListingFields(request, token, listingId, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:3', 'allow_offers:true'],
    })
    api = await fetchListingApi(request, token, listingId)
    expect(String(api.saleType ?? api.saleTypeDisplay ?? '')).toMatch(/obo|best offer/i)

    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-shipping-card').getByText(/OBO|Best offer/i)).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-obo-persisted.png'),
    )

    const ends = new Date(Date.now() + 72 * 3600 * 1000).toISOString()
    await patchListingFields(request, token, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:2500',
        'reserve_price_cents:5000',
        `auction_ends_at:${ends}`,
      ],
    })
    api = await fetchListingApi(request, token, listingId)
    expect(String(api.saleType ?? api.saleTypeDisplay ?? '')).toMatch(/auction/i)

    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-shipping-card').getByText(/Auction/i)).toBeVisible({
      timeout: 15_000,
    })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-auction-persisted.png'),
    )

    await page.goto(`/listings/${listingId}/revisions`)
    await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.locator('body')).toContainText(/Sale type/i)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-sale-mode-persisted.png'),
    )
  })
})
