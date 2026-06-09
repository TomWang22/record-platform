import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken, signInWithToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Auction product UI contract', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `Auction Product UI ${Date.now()}`,
    })
    const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:1500',
        'bid_increment_cents:100',
        'reserve_price_cents:1800',
        `auction_ends_at:${ends}`,
      ],
    })
  })

  test('buyer sees auction panel on listing detail', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-auction-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('listing-auction-current-bid')).toBeVisible()
    await assertNoStaleProductUi(page, 'auction listing detail')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-auction-active.png'),
    )
  })

  test('buyer places proxy bid from panel', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-auction-panel')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('listing-auction-proxy-toggle').check()
    await page.getByTestId('listing-auction-bid-input').fill('25.00')
    await page.getByTestId('listing-auction-submit').click()
    await expect(page.getByTestId('listing-auction-success')).toBeVisible({ timeout: 30_000 })
    await assertNoStaleProductUi(page, 'auction proxy bid')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-auction-proxy-bid.png'),
    )
  })

  test('bid history modal shows items', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-auction-panel')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('listing-auction-history-toggle').click()
    await expect(page.getByTestId('listing-auction-history-item').first()).toBeVisible({
      timeout: 15_000,
    })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-auction-bid-history.png'),
    )
  })
})
