import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  pollRecordsUntilArtist,
  waitForRecordVisibleAfterFilter,
  waitForRecordsCollectionLoaded,
} from './helpers/records-contract'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Records collection filter contract (7.8)', () => {
  let milesRecordId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    await timed('records/seed', () => ensureTestCollection(ctx.request, token))
    const miles = await pollRecordsUntilArtist(ctx.request, token, 'Miles Davis')
    milesRecordId = miles.id
    const detail = await ctx.request.get(`/api/records/${milesRecordId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(detail.ok()).toBeTruthy()
    await pollRecordsUntilArtist(ctx.request, token, 'Kenny Dorham')
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('grid list compact with images and auction filter', async ({ page }) => {
    await page.goto('/records?view=grid')
    await waitForRecordsCollectionLoaded(page)

    await page.getByPlaceholder(/Search artist/i).fill('Kenny Dorham')
    await page.getByRole('button', { name: 'Search' }).click()
    const kennyCard = page
      .getByTestId('record-card')
      .filter({ hasText: 'Kenny Dorham' })
      .first()
      .or(page.locator('article').filter({ hasText: 'Kenny Dorham' }).first())
    await expect(kennyCard).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('article').filter({ hasText: 'Miles Davis' })).toHaveCount(0)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-grid-images-filtered.png'),
    )

    await page.goto('/records?view=list')
    await waitForRecordsCollectionLoaded(page)
    await page.getByPlaceholder(/Search artist/i).fill('Kenny Dorham')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(
      page
        .getByTestId('record-row')
        .filter({ hasText: 'Kenny Dorham' })
        .first()
        .or(page.locator('tbody tr').filter({ hasText: 'Kenny Dorham' }).first()),
    ).toBeVisible({ timeout: 60_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-list-images-filtered.png'),
    )

    await page.goto('/records?view=compact')
    await waitForRecordsCollectionLoaded(page)
    await page.getByPlaceholder(/Search artist/i).fill('Kenny Dorham')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(kennyCard).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('records-filter-purchase-type').selectOption('auction_win')
    await expect(kennyCard).toBeVisible()
    await expect(page.locator('article').filter({ hasText: 'Art Blakey' })).toHaveCount(0)

    await page.getByTestId('records-filter-purchased-from').fill('2026-05-01')
    await page.getByTestId('records-filter-purchased-to').fill('2026-05-01')
    await expect(kennyCard).toBeVisible()
    await expect(page.locator('article').filter({ hasText: 'Herbie Hancock' })).toHaveCount(0)

    await page.getByTestId('records-filter-listed').selectOption('listed')
    await expect(kennyCard).toBeVisible()
    await page.getByTestId('records-filter-listed').selectOption('not_listed')
    await expect(kennyCard).toHaveCount(0)
    await page.getByTestId('records-filter-listed').selectOption('')
    await expect(kennyCard).toBeVisible()

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-compact-images-filtered.png'),
    )
  })

  test('artist filter and record detail edit revision', async ({ page }) => {
    await page.goto('/records?view=grid')
    await waitForRecordsCollectionLoaded(page)
    await page.getByTestId('records-filter-purchase-type').selectOption('')
    await page.getByTestId('records-filter-listed').selectOption('')

    await waitForRecordVisibleAfterFilter(page, 'Miles Davis')
    await expect(page.getByTestId('record-card').filter({ hasText: 'Kenny Dorham' })).toHaveCount(0)

    const milesCard = page.getByTestId('record-card').filter({ hasText: 'Miles Davis' }).first()
    const detailResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/records/${milesRecordId}`) &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 45_000 },
    )
    await Promise.all([
      detailResponse,
      milesCard.getByRole('link', { name: 'View' }).click(),
    ])
    await expect(page).toHaveURL(new RegExp(`/records/${milesRecordId.replace(/-/g, '\\-')}`))
    await expect(page.getByTestId('record-detail-ready')).toBeVisible({ timeout: 45_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-record-detail-editable.png'),
    )

    const editNote = `E2E note ${Date.now()}`
    await page.goto(`/records/${milesRecordId}/edit`, { waitUntil: 'domcontentloaded' })
    const notes = page.getByLabel(/Collection notes/i)
    await expect(notes).toBeVisible({ timeout: 15_000 })
    await notes.fill(editNote)
    const saveResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/records/${milesRecordId}`) &&
        r.request().method() === 'PUT' &&
        r.ok(),
      { timeout: 45_000 },
    )
    await page.getByRole('button', { name: /Save changes/i }).click()
    await saveResponse
    await expect(page).toHaveURL(
      new RegExp(`/records/${milesRecordId.replace(/-/g, '\\-')}(\\?tab=revisions)?$`),
      { timeout: 45_000 },
    )

    await page.goto(`/records/${milesRecordId}/revisions`)
    await expect(page.locator('body')).not.toContainText('Loading revision history', {
      timeout: 45_000,
    })
    const revBody = await page.locator('body').innerText()
    expect(revBody).not.toMatch(/"to"\s*:/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-record-revisions-readable.png'),
    )
  })
})
