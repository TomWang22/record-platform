import { test, expect } from '@playwright/test'

import {
  obtainBuyerContractToken,
  obtainSellerContractToken,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO offer product UI contract', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(request))
    listingId = await timed('seller/listing', () =>
      createListingWithShipping(request, sellerToken, {
        title: `OBO Product UI ${Date.now()}`,
      }),
    )
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: [
        'sale_type:obo',
        'max_offer_attempts:5',
        'allow_offers:true',
        'offer_expiration_hours:48',
        'min_offer_cents:1500',
      ],
    })
  })

  test('buyer sees make offer panel on listing detail', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}?makeOffer=1`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-make-offer-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('listing-offer-attempts-remaining')).toBeVisible()
    await expect(page.getByTestId('listing-offer-amount-input')).toBeVisible()
    await assertNoStaleProductUi(page, 'OBO listing detail')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-make-offer-panel.png'),
    )
  })

  test('buyer submits offer from panel', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}?makeOffer=1`)
    await expect(page.getByTestId('listing-make-offer-panel')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('listing-offer-amount-input').fill('18.00')
    await page.getByTestId('listing-offer-message-input').fill('Fair offer from UI')
    await page.getByTestId('listing-offer-submit').click()
    await expect(page.getByTestId('listing-offer-success')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('listing-offer-history-item').first()).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-offer-submitted.png'),
    )
  })

  test('seller sees offer in inbox UI', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken)
    await page.goto('/offers/inbox')
    await expect(page.getByTestId('offers-inbox-page')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('offers-list-inbox').or(page.getByTestId('offers-list-item'))).toBeVisible({
      timeout: 30_000,
    })
    await assertNoStaleProductUi(page, 'offer inbox')
    await capturePageContentScreenshot(page, contractScreenshotPath('authenticated-offers-inbox.png'))
  })

  test('buyer sees offer in sent UI', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto('/offers/sent')
    await expect(page.getByTestId('offers-sent-page')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('offers-list-sent').or(page.getByTestId('offers-list-item'))).toBeVisible({
      timeout: 30_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('authenticated-offers-sent.png'))
  })
})
