import { test, expect } from '@playwright/test'

import { signInAsTestCollector } from './helpers/auth'

test.describe('Guest session contract', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('dashboard shows Guest + AuthRequiredCard, not standalone login form', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /^Guest$/i })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /Sign in to view your dashboard/i }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: /^Sign in$/i, level: 1 })).toHaveCount(0)
  })
})

test.describe('Authenticated session contract', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  const protectedRoutes = [
    '/dashboard',
    '/cart',
    '/auctions',
    '/records',
    '/records/new',
    '/market',
    '/settings',
    '/listings',
  ] as const

  for (const path of protectedRoutes) {
    test(`signed-in ${path} shows Test Collector + Sign out, no AuthRequiredCard`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(page.getByText('Test Collector').first()).toBeVisible({ timeout: 12_000 })
      await expect(page.getByRole('button', { name: /^Guest$/i })).toHaveCount(0)
      const signOutCount =
        (await page.getByRole('button', { name: /^Sign out$/i }).count()) +
        (await page.getByRole('menuitem', { name: /^Sign out$/i }).count())
      expect(signOutCount).toBeGreaterThan(0)
    })
  }
})
