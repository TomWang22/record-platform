import { expect, type Page } from '@playwright/test'

/** Product UI must never show legacy OCH/housing/dev-provider strings. */
const STALE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /Provider:\s*dev/i, label: 'Provider: dev' },
  { re: /Provider dev/i, label: 'Provider dev' },
  { re: /\bOff-Campus\b/i, label: 'Off-Campus' },
  { re: /\bHousing\b/i, label: 'Housing' },
  { re: /\bOCH\b/, label: 'OCH' },
  { re: /\bbooking\b/i, label: 'booking' },
  { re: /\blandlord\b/i, label: 'landlord' },
  { re: /\blease\b/i, label: 'lease' },
  { re: /\btenant\b/i, label: 'tenant' },
  { re: /\brent\b/i, label: 'rent' },
  { re: /\bfurnished\b/i, label: 'furnished' },
  { re: /Format:\s*apartment/i, label: 'Format: apartment' },
  { re: /\bapartment\b/i, label: 'apartment' },
]

export async function assertNoStaleProductUi(page: Page, context = 'page'): Promise<void> {
  const body = await page.locator('body').innerText()
  for (const { re, label } of STALE_PATTERNS) {
    expect(body, `${context} must not contain "${label}"`).not.toMatch(re)
  }
}

export async function assertWebappBuildMarkerChanged(
  page: import('@playwright/test').APIRequestContext,
  expectedSha: string,
): Promise<void> {
  const res = await page.get('/api/webapp-version')
  expect(res.ok()).toBeTruthy()
  const json = (await res.json()) as { buildSha?: string }
  expect(json.buildSha).toBe(expectedSha)
  expect(json.buildSha).not.toBe('unknown')
}
