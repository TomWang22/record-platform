import { test, expect, type Page } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { seedRecordsForToolbarFilters } from './helpers/seed-records-filters'
import { waitForRecordsCollectionLoaded } from './helpers/records-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
  waitForRecordsReady,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Records toolbar filter contract (6.1)', () => {
  let earlyId = ''
  let midId = ''
  let lateId = ''
  let earlyArtist = ''
  let midArtist = ''
  let lateArtist = ''
  let runTag = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    const ids = await timed('records/filter-seed', () =>
      seedRecordsForToolbarFilters(ctx.request, token),
    )
    earlyId = ids.earlyId
    midId = ids.midId
    lateId = ids.lateId
    earlyArtist = ids.earlyArtist
    midArtist = ids.midArtist
    lateArtist = ids.lateArtist
    runTag = ids.runTag
    await ctx.close()
  })

  async function focusSeededRecords(page: Page, view: 'grid' | 'list' | 'compact') {
    await waitForRecordsCollectionLoaded(page)
    await page.getByPlaceholder('Search artist, album, catalog, label…').fill(runTag)
    await page.getByRole('button', { name: 'Search' }).click()
    const hit = page
      .getByTestId('record-card')
      .filter({ hasText: midArtist })
      .first()
      .or(page.getByTestId('record-compact-item').filter({ hasText: midArtist }).first())
      .or(page.getByTestId('record-row').filter({ hasText: midArtist }).first())
    await expect(hit).toBeVisible({ timeout: 45_000 })
  }

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('purchased date range filter', async ({ page }) => {
    await waitForRecordsReady(page, 'grid')
    await focusSeededRecords(page, 'grid')
    await page.getByTestId('records-filter-purchased-from').fill('2026-03-01')
    await page.getByTestId('records-filter-purchased-to').fill('2026-03-31')
    await expect(page.getByTestId('record-card').filter({ hasText: midArtist })).toBeVisible()
    await expect(page.getByTestId('record-card').filter({ hasText: earlyArtist })).toHaveCount(0)
    await expect(page.getByTestId('record-card').filter({ hasText: lateArtist })).toHaveCount(0)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-filter-purchased-date.png'),
    )
    expect(midId).toBeTruthy()
    expect(earlyId).toBeTruthy()
    expect(lateId).toBeTruthy()
  })

  test('received date range filter', async ({ page }) => {
    await waitForRecordsReady(page, 'list')
    await focusSeededRecords(page, 'list')
    await page.getByTestId('records-filter-purchased-from').fill('')
    await page.getByTestId('records-filter-purchased-to').fill('')
    await page.getByTestId('records-filter-received-from').fill('2026-05-01')
    await page.getByTestId('records-filter-received-to').fill('2026-05-31')
    await expect(page.getByTestId('record-row').filter({ hasText: lateArtist })).toBeVisible()
    await expect(page.getByTestId('record-row').filter({ hasText: midArtist })).toHaveCount(0)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-filter-received-date.png'),
    )
  })

  test('listed and not listed filters', async ({ page }) => {
    await page.goto('/records?view=compact')
    await focusSeededRecords(page, 'compact')
    await page.getByTestId('records-filter-received-from').fill('')
    await page.getByTestId('records-filter-received-to').fill('')
    await page.getByTestId('records-filter-listed').selectOption('listed')
    await expect(
      page
        .getByTestId('record-compact-item')
        .filter({ hasText: midArtist })
        .or(page.getByTestId('record-card').filter({ hasText: midArtist })),
    ).toBeVisible()
    await expect(page.getByTestId('record-listing-status').filter({ hasText: 'Listed' }).first()).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-filter-listed.png'),
    )

    await page.getByTestId('records-filter-listed').selectOption('not_listed')
    await expect(page.getByTestId('record-compact-item').filter({ hasText: midArtist })).toHaveCount(0)
    await expect(
      page
        .getByTestId('record-compact-item')
        .filter({ hasText: earlyArtist })
        .or(page.getByTestId('record-card').filter({ hasText: earlyArtist })),
    ).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-filter-not-listed.png'),
    )
  })
})
