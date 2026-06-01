import { expect, type Page } from '@playwright/test'

const HEADER_DUPLICATE_PATTERNS = [
  /Dashboard\s*\n\s*Welcome back/i,
  /\bLIVE MODE\b/i,
]

/** Sticky header must not appear duplicated inside main page content (fullPage screenshot artifact). */
export async function assertNoHeaderOverlayInPageContent(page: Page): Promise<void> {
  const content = page.getByTestId('page-content')
  await expect(content).toBeVisible({ timeout: 15_000 })
  const text = await content.innerText()
  for (const re of HEADER_DUPLICATE_PATTERNS) {
    expect(text, `page-content must not duplicate AppShell header (${re})`).not.toMatch(re)
  }
  const welcomeCount = (text.match(/Welcome back/g) ?? []).length
  expect(welcomeCount, 'Welcome back must not appear inside page-content').toBe(0)
}
