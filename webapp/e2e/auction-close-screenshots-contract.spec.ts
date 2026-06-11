import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  BIDDER2_CONTRACT_EMAIL,
  obtainBidder2ContractToken,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  SELLER_CONTRACT_EMAIL,
  signInWithToken,
} from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'
import { ensureMarketplaceBrowseSaleMix } from './helpers/seed-marketplace-browse'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
  waitForListingsReady,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe.configure({ timeout: 240_000 })

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'X-RP-E2E-Contract': '1',
})

test.describe.serial('Auction close UI screenshots', () => {
  let listingId = ''
  let listingTitle = ''
  let winnerToken = ''
  let loserToken = ''
  let sellerToken = ''

  test.beforeAll(async ({ request }) => {
    sellerToken = await obtainSellerContractToken(request)
    winnerToken = await obtainBuyerContractToken(request)
    loserToken = await obtainBidder2ContractToken(request)
    listingTitle = `Auction Close UI ${Date.now()}`
    listingId = await createListingWithShipping(request, sellerToken, {
      title: listingTitle,
    })
    const ends = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:2000',
        'bid_increment_cents:100',
        'reserve_price_cents:2200',
        `auction_ends_at:${ends}`,
      ],
    })

    for (const [token, amount] of [
      [winnerToken, 2200],
      [loserToken, 2300],
      [winnerToken, 2500],
    ] as const) {
      const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
        headers: headers(token),
        data: { amountCents: amount },
      })
      expect(res.status()).toBe(201)
    }

    const closed = await request.post(`/api/listings/${listingId}/auction/close?force=1`, {
      headers: headers(sellerToken),
      data: { force: true },
    })
    expect(closed.ok()).toBeTruthy()
  })

  test('ended winner state on listing detail', async ({ page }) => {
    await signInWithToken(page, winnerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-auction-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('listing-auction-status')).toHaveText('ended')
    await expect(page.getByTestId('listing-auction-viewer-state')).toHaveText('won')
    await assertNoStaleProductUi(page, 'auction ended winner')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-auction-ended-winner.png'),
    )
  })

  test('ended loser state on listing detail', async ({ page }) => {
    await signInWithToken(page, loserToken, BIDDER2_CONTRACT_EMAIL)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-auction-panel')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-auction-viewer-state')).toHaveText('lost')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-auction-ended-loser.png'),
    )
  })

  test('winner cart reservation after auction close', async ({ page, request }) => {
    type CartRow = {
      listing_id?: string
      item_id?: string
      metadata?: { purchase_type?: string }
    }
    await expect
      .poll(
        async () => {
          try {
            const cart = await getJsonWith429Retry<{ items?: CartRow[] }>(
              request,
              '/api/cart',
              headers(winnerToken),
              'winner cart after auction close',
            )
            return (cart.items ?? []).find(
              (i) =>
                String(i.listing_id || i.item_id) === listingId &&
                i.metadata?.purchase_type === 'auction_win',
            )
          } catch {
            return null
          }
        },
        { timeout: 120_000 },
      )
      .toBeTruthy()

    await signInWithToken(page, winnerToken, BUYER_CONTRACT_EMAIL)
    await page.goto('/cart')
    await expect(page.getByTestId('cart-page-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('h3').filter({ hasText: listingTitle })).toBeVisible({ timeout: 60_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-cart-auction-win-reservation.png'),
    )
  })

  test('browse mixed sale types including sold auction', async ({ page, request }) => {
    await ensureMarketplaceBrowseSaleMix(request, sellerToken)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/listings')
    await waitForListingsReady(page, 'grid')
    await page.getByText('Include sold listings').click()
    await page.waitForTimeout(1500)
    await expect(
      page.locator('[data-testid="listing-card"][data-sale-mode="fixed"]').first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('[data-testid="listing-card"][data-sale-mode="obo"]').first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator('[data-testid="listing-card"][data-sale-mode="auction"]').first(),
    ).toBeVisible({ timeout: 30_000 })
    await assertNoStaleProductUi(page, 'browse mixed sale types')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-marketplace-browse-mixed-sale-types.png'),
    )
  })
})
