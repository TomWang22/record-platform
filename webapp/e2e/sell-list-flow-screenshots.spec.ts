import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInAsTestCollector } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  captureScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

const UNIQUE_TITLE = `E2E UI Listing ${Date.now()}`

test.describe('Sell/list UI flow screenshots', () => {
  test.describe.configure({ timeout: 180_000 })

  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  test('sell workflow through publish and revisions', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await ensureTestCollection(request, token!)
    const records = await getJsonWith429Retry<{ artist: string; name: string }[]>(
      request,
      '/api/records',
      { Authorization: `Bearer ${token!}`, 'X-RP-E2E-Contract': '1' },
      'sell-flow records',
    )
    expect(records.length).toBeGreaterThan(0)
    const pick = records[0]

    await page.goto('/sell')
    await waitForNoLoadingStates(page, '/sell')
    await expect(page.getByRole('heading', { name: 'Create listing' })).toBeVisible({
      timeout: 30_000,
    })
    const recordOption = page
      .getByRole('button', { name: new RegExp(`${pick.artist}.*${pick.name}`) })
      .first()
    await expect(recordOption).toBeVisible({ timeout: 60_000 })
    await captureScreenshot(page, contractScreenshotPath('authenticated-sell-select-record.png'))

    await recordOption.click()
    await captureScreenshot(page, contractScreenshotPath('authenticated-sell-media-upload.png'))

    await page.getByPlaceholder('Title *').fill(UNIQUE_TITLE)
    await page.getByPlaceholder('Subtitle').fill('Blue Note stereo pressing')
    await page
      .getByPlaceholder('Description')
      .fill('Paragraph one: quiet vinyl.\n\nParagraph two: plays clean.\n\nParagraph three: ships insured.')
    await page.getByPlaceholder('Condition notes').fill('VG+ / VG sleeve')
    await page.getByPlaceholder('Price (USD)').fill('55')
    await page.getByPlaceholder('Ships from country').fill('US')
    await page.getByPlaceholder('State / region').fill('NY')
    await page.getByPlaceholder('Postal code').fill('11201')
    await page.getByPlaceholder('Domestic shipping ($)').fill('5')
    await page.getByPlaceholder('International shipping ($)').fill('18')
    await captureScreenshot(page, contractScreenshotPath('authenticated-sell-pricing-shipping.png'))

    const saveDraft = page.getByRole('button', { name: 'Save draft' })
    await expect(saveDraft).toBeEnabled({ timeout: 30_000 })
    await saveDraft.click()
    await expect(page.getByText('Draft saved.')).toBeVisible({ timeout: 90_000 })

    const publishBtn = page.getByRole('button', { name: 'Publish' })
    await expect(publishBtn).toBeEnabled({ timeout: 30_000 })
    await publishBtn.click()
    await expect(page.getByText('Listing published.')).toBeVisible({ timeout: 90_000 })
    await captureScreenshot(page, contractScreenshotPath('authenticated-sell-preview.png'))

    let createdListingId = ''
    for (let attempt = 0; attempt < 20; attempt++) {
      const mine = await request.get('/api/listings/mine', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(mine.ok()).toBeTruthy()
      const created = ((await mine.json()) as { items?: { id: string; title?: string }[] }).items?.find(
        (l) => l.title === UNIQUE_TITLE,
      )
      if (created?.id) {
        createdListingId = created.id
        break
      }
      await page.waitForTimeout(1000)
    }
    expect(createdListingId).toBeTruthy()

    await page.goto(`/listings/${createdListingId}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(UNIQUE_TITLE, {
      timeout: 30_000,
    })
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-with-image.png'),
      { fullPage: true },
    )

    await page.goto(`/listings/${createdListingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 60_000 })
    await page.locator('input').first().fill(`${UNIQUE_TITLE} (revised)`)
    await captureScreenshot(page, contractScreenshotPath('authenticated-listing-edit.png'))
    await page.getByRole('button', { name: /save changes/i }).click()
    await page.waitForURL(new RegExp(`/listings/${createdListingId.replace(/-/g, '\\-')}$`), {
      timeout: 90_000,
    })
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 60_000 })

    const revRes = await request.get(`/api/listings/${createdListingId}/revisions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(revRes.ok()).toBeTruthy()
    const revisions = (await revRes.json()) as { items?: { id: string }[] }
    expect((revisions.items ?? []).length).toBeGreaterThan(0)

    await page.goto(`/listings/${createdListingId}/revisions`)
    await expect(page.locator('ol').first()).toBeVisible({ timeout: 30_000 })
    await captureScreenshot(page, contractScreenshotPath('authenticated-listing-revisions.png'))

    test.info().annotations.push({
      type: 'createdListingId',
      description: createdListingId,
    })
    test.info().annotations.push({
      type: 'revisionIds',
      description: (revisions.items ?? []).map((r) => r.id).join(','),
    })
  })
})
