import { test, expect } from '@playwright/test'

import { signInAsTestCollector } from './helpers/auth'

const guestRoutes = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'records', path: '/records' },
  { name: 'records-new', path: '/records/new' },
  { name: 'cart', path: '/cart' },
  { name: 'auctions', path: '/auctions' },
  { name: 'listings', path: '/listings' },
  { name: 'sell', path: '/market' },
  { name: 'settings', path: '/settings' },
  { name: 'forum', path: '/forum' },
  { name: 'messages', path: '/messages' },
  { name: 'insights', path: '/insights' },
  { name: 'observation-deck', path: '/observation-deck' },
] as const

test.describe('Guest screenshots', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const route of guestRoutes) {
    test(`guest screenshot: ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(800)
      const body = (await page.textContent('body')) ?? ''
      expect(body).not.toContain('Application error')
      expect(body).not.toContain('client-side exception')
      await page.screenshot({
        path: `e2e/screenshots/guest/${route.name}.png`,
        fullPage: true,
      })
    })
  }
})

test.describe('Authenticated screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  for (const route of guestRoutes) {
    test(`authenticated screenshot: ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1200)
      const body = (await page.textContent('body')) ?? ''
      expect(body).not.toContain('Application error')
      expect(body).not.toContain('client-side exception')
      expect(body).not.toContain('listing_id must be a valid UUID')
      await expect(page.getByText('Test Collector').first()).toBeVisible({ timeout: 10_000 })
      await page.screenshot({
        path: `e2e/screenshots/authenticated/${route.name}.png`,
        fullPage: true,
      })
    })
  }
})
