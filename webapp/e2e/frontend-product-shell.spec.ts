import { test, expect } from '@playwright/test'

import { signInAsTestCollector } from './helpers/auth'

test.describe('Frontend product shell', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  test('dashboard stat cards navigate', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('link').filter({ hasText: 'Total Records' }).first().click()
    await expect(page).toHaveURL(/\/records/)
    await page.goto('/dashboard')
    await page.locator('a[href="/sell"]').first().click()
    await expect(page).toHaveURL(/\/sell/)
  })

  test('sell shows full listing workflow', async ({ page }) => {
    await page.goto('/sell')
    await expect(page.getByRole('heading', { name: /Create listing/i })).toBeVisible()
    await expect(page.getByText('1) Select record')).toBeVisible()
    await expect(page.getByText('5) Shipping')).toBeVisible()
    await expect(page.getByText('Comparables (helper)')).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-sell-full-form.png', fullPage: true })
  })

  test('global cart icon visible', async ({ page }) => {
    await page.goto('/records')
    await expect(page.getByRole('button', { name: /Cart/i })).toBeVisible()
    await page.getByRole('button', { name: /Cart/i }).click()
    await expect(page.getByRole('link', { name: 'View cart' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-cart-popover.png' })
  })

  test('profile and watchlist routes', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: /Your profile/i })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-profile.png', fullPage: true })
    await page.goto('/watchlist')
    await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-watchlist.png', fullPage: true })
    await page.goto('/recently-viewed')
    await expect(page.getByRole('heading', { name: /Recently viewed/i })).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/authenticated/authenticated-recently-viewed.png', fullPage: true })
  })

  test('public profile shell', async ({ page }) => {
    await page.goto('/users/test-collector')
    await expect(page.getByText(/test-collector/i)).toBeVisible()
    await page.screenshot({ path: 'e2e/screenshots/guest/public-user-profile.png', fullPage: true })
  })
})
