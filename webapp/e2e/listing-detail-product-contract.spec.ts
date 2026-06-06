import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { timed } from './helpers/seed-lean'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoHeaderOverlayInPageContent } from './helpers/page-content-guard'
import {
  FULL_SHIPPING,
  createListingWithShipping,
  fetchListingApi,
  waitForListingField,
} from './helpers/listing-contract'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe.configure({ timeout: 120_000 })

function publicShipping(row: Record<string, unknown>): Record<string, unknown> {
  const sh = row.shipping
  return sh && typeof sh === 'object' && !Array.isArray(sh) ? (sh as Record<string, unknown>) : {}
}

function listingDetailApiReady(row: Record<string, unknown>, title: string): boolean {
  const sh = publicShipping(row)
  const domesticCents =
    row.domestic_shipping_cents != null
      ? Number(row.domestic_shipping_cents)
      : sh.domestic != null
        ? Math.round(Number(sh.domestic) * 100)
        : -1
  const service = String(row.shipping_service ?? row.shippingService ?? sh.service ?? '')
  return (
    String(row.title ?? row.name ?? '') === title &&
    domesticCents === FULL_SHIPPING.domestic_shipping_cents &&
    service.includes('Media')
  )
}

test.describe.serial('Listing detail product contract (7.4)', () => {
  let listingId = ''
  let listingTitle = ''

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const token = await timed('auth/login', () => obtainAuthToken(ctx.request))
    listingTitle = `E2E Detail Product ${Date.now()}`
    listingId = await timed('listing/create', () =>
      createListingWithShipping(ctx.request, token, { title: listingTitle }),
    )
    await waitForListingField(ctx.request, token, listingId, (row) =>
      listingDetailApiReady(row, listingTitle),
    )
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('detail shows shipping, seller, contact — API matches UI', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const api = await waitForListingField(request, token, listingId, (row) =>
      listingDetailApiReady(row, listingTitle),
    )
    const sh = publicShipping(api)
    const service = String(api.shipping_service ?? sh.service ?? '')
    const domesticCents =
      api.domestic_shipping_cents != null
        ? Number(api.domestic_shipping_cents)
        : Math.round(Number(sh.domestic ?? 0) * 100)
    const internationalCents =
      api.international_shipping_cents != null
        ? Number(api.international_shipping_cents)
        : Math.round(Number(sh.international ?? 0) * 100)
    expect(service).toBe(FULL_SHIPPING.shipping_service)
    expect(domesticCents).toBe(FULL_SHIPPING.domestic_shipping_cents)
    expect(internationalCents).toBe(FULL_SHIPPING.international_shipping_cents)
    expect(String(api.package_type ?? sh.package ?? '')).toBe(FULL_SHIPPING.package_type)
    expect(String(api.shipping_notes ?? sh.notes ?? '')).toBe(FULL_SHIPPING.shipping_notes)
    expect(api.priceDisplay).toMatch(/^\$\d+\.\d{2}$/)

    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-shipping-card')).toBeVisible()
    await expect(page.getByTestId('listing-seller-card')).toBeVisible()
    await expect(page.getByTestId('contact-seller-button')).toBeVisible()
    const contact = page.getByTestId('contact-seller-button')
    await expect(contact).toHaveAttribute('href', new RegExp(`/messages\\?.*listing=${listingId}`))
    const card = page.getByTestId('listing-shipping-card')
    await expect(card.getByText(FULL_SHIPPING.shipping_service)).toBeVisible()
    await expect(card.getByText('$5.00')).toBeVisible()
    await expect(card.getByText('$15.00')).toBeVisible()
    await expect(card.getByText(FULL_SHIPPING.package_type)).toBeVisible()
    await expect(card.getByText(/Brooklyn/)).toBeVisible()
    await expect(card.getByText(FULL_SHIPPING.shipping_notes)).toBeVisible()
    await assertNoStaleProductUi(page, 'listing detail 7.4R')
    await assertNoHeaderOverlayInPageContent(page)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-clean-shipping-contact.png'),
    )
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-product-complete.png'),
    )
    await expect(page.getByTestId('listing-listed-at')).toBeVisible()
    await expect(page.getByTestId('listing-listed-at')).toContainText(/EDT|EST|PDT|PST|UTC/i)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-shipping-dates.png'),
    )
  })
})
