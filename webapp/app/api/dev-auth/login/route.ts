import { NextResponse } from 'next/server'

import { DEV_AUTH_TEST_USER, isDevAuthEnabled } from '@/lib/dev-auth'
import { getApiGatewayUrl } from '@/lib/server-api'

export const dynamic = 'force-dynamic'

/**
 * Dev-only: ensure test collector exists and return a real gateway JWT.
 * Disabled unless RP_FRONTEND_DEV_AUTH=1 or NEXT_PUBLIC_RP_DEV_AUTH=1.
 */
export async function POST() {
  if (!isDevAuthEnabled()) {
    return NextResponse.json({ error: 'Dev auth is disabled' }, { status: 403 })
  }

  const base = getApiGatewayUrl()
  const { email, password, name } = DEV_AUTH_TEST_USER

  try {
    await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    // register may fail if user exists — continue to login
  }

  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  const loginBody = (await loginRes.json().catch(() => ({}))) as {
    token?: string
    error?: string
    requiresMFA?: boolean
  }

  if (!loginRes.ok || !loginBody.token) {
    return NextResponse.json(
      {
        error: loginBody.error ?? 'Dev login failed',
        status: loginRes.status,
        requiresMFA: loginBody.requiresMFA,
      },
      { status: loginRes.status >= 400 ? loginRes.status : 502 },
    )
  }

  return NextResponse.json({
    token: loginBody.token,
    profile: {
      name,
      email,
      initials: 'TC',
      provider: DEV_AUTH_TEST_USER.provider,
      avatarUrl: undefined,
    },
  })
}
