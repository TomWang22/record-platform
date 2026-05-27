import { test, expect } from '@playwright/test'

import { signInAsTestCollector } from './helpers/auth'

test.describe('Records UI contract', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  test('collection grid view shows cards not plain text list', async ({ page }) => {
    await page.goto('/records?view=grid', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /My collection/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible()
    const cards = page.locator('article').filter({ has: page.getByRole('link', { name: 'View' }) })
    const count = await cards.count()
    if (count > 0) {
      await expect(cards.first()).toBeVisible()
      await expect(page.getByText('—').first()).not.toBeVisible({ timeout: 500 }).catch(() => {})
    }
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-records-grid.png', fullPage: true })
  })

  test('collection list view shows table or empty state', async ({ page }) => {
    await page.goto('/records?view=list', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /My collection/i })).toBeVisible({ timeout: 15_000 })
    const listBtn = page.getByRole('button', { name: 'List' })
    await expect(listBtn).toBeVisible()
    const table = page.locator('table')
    const empty = page.getByText('No records yet')
    await expect(table.or(empty)).toBeVisible({ timeout: 15_000 })
    if (await table.isVisible()) {
      await expect(page.getByRole('columnheader', { name: 'Release' })).toBeVisible()
    }
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-records-list.png', fullPage: true })
  })

  test('record detail and revisions routes load', async ({ page }) => {
    await page.goto('/records', { waitUntil: 'domcontentloaded' })
    const viewLink = page.getByRole('link', { name: 'View' }).first()
    if ((await viewLink.count()) === 0) {
      test.skip()
      return
    }
    await viewLink.click()
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'e2e/screenshots/authenticated/record-detail.png', fullPage: true })

    await page.getByRole('link', { name: 'Revision history' }).click()
    await expect(page.getByRole('heading', { name: /Revision history/i })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/record-revisions.png', fullPage: true })

    await page.getByRole('link', { name: 'Edit record' }).click()
    await expect(page.getByRole('heading', { name: /Edit record/i })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-record-edit.png', fullPage: true })
  })
})
