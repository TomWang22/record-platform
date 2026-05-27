import type { Page } from '@playwright/test'

import { ensureTestCollection } from './seed-collection'

const TEST_PASSWORD = 'record-platform-dev-test'
const TEST_PROFILE = {
  name: 'Test Collector',
  email: 'collector-e2e@record-platform.local',
  initials: 'TC',
  provider: 'dev' as const,
}

export async function signInAsTestCollector(page: Page): Promise<void> {
  let token: string
  let profile = TEST_PROFILE

  const devLogin = await page.request.post('/api/dev-auth/login')
  if (devLogin.ok()) {
    const devData = (await devLogin.json()) as {
      token?: string
      profile?: typeof TEST_PROFILE
    }
    if (devData.token) {
      token = devData.token
      profile = devData.profile ?? TEST_PROFILE
    } else {
      throw new Error('Dev login response missing token')
    }
  } else {
    let login = await page.request.post('/auth/login', {
      data: { email: TEST_PROFILE.email, password: TEST_PASSWORD },
    })
    if (!login.ok()) {
      await page.request.post('/auth/register', {
        data: {
          email: TEST_PROFILE.email,
          password: TEST_PASSWORD,
          name: TEST_PROFILE.name,
        },
      })
      login = await page.request.post('/auth/login', {
        data: { email: TEST_PROFILE.email, password: TEST_PASSWORD },
      })
    }
    if (!login.ok()) {
      throw new Error(`Login failed: ${login.status()} ${await login.text()}`)
    }
    const data = (await login.json()) as { token?: string }
    if (!data.token) {
      throw new Error('Login response missing token')
    }
    token = data.token
    profile = TEST_PROFILE
  }

  await ensureTestCollection(page.request, token)

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ sessionToken, sessionProfile }) => {
      window.localStorage.setItem('record-platform.token', sessionToken)
      window.localStorage.setItem('record-platform.dev-profile', JSON.stringify(sessionProfile))
    },
    { sessionToken: token, sessionProfile: profile },
  )
}

/** UI path: login page dev button (requires NEXT_PUBLIC_RP_DEV_AUTH=1). */
export async function signInAsTestCollectorViaUi(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  const devButton = page.getByRole('button', { name: /Continue as Test Collector/i })
  await devButton.click()
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
}
