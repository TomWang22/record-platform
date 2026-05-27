import { test, expect } from '@playwright/test'

const APP_SHELL = 'Catalog Intelligence'

test.describe('Cart contract', () => {
  test('guest /cart: AppShell, title, auth card, no client crash', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.goto('/cart', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible()
    await expect(page.getByText('Sign in to view your cart')).toBeVisible({ timeout: 10_000 })

    const body = (await page.textContent('body')) ?? ''
    expect(body).not.toContain('Application error')
    expect(body).not.toContain('client-side exception')
    expect(body).toContain(APP_SHELL)
    expect(body).toContain('Shopping Cart')
    expect(body).toContain('Sign in to view your cart')
    expect(consoleErrors.join('\n')).not.toMatch(/Cannot read properties of null/i)
  })
})
