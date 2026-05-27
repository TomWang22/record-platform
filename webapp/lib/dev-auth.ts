/** Dev-only frontend auth helpers. Never enable in production by default. */

export type DevSessionProfile = {
  name?: string
  email?: string
  avatarUrl?: string
  initials: string
  provider: 'dev'
}

export const DEV_AUTH_TEST_USER = {
  email: 'collector@record-platform.local',
  password: 'record-platform-dev-test',
  name: 'Test Collector',
  provider: 'dev' as const,
}

export function isDevAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return (
      process.env.RP_FRONTEND_DEV_AUTH === '1' ||
      process.env.NEXT_PUBLIC_RP_DEV_AUTH === '1'
    )
  }
  return (
    process.env.RP_FRONTEND_DEV_AUTH === '1' ||
    process.env.NEXT_PUBLIC_RP_DEV_AUTH === '1' ||
    process.env.NEXT_PUBLIC_RP_DEV_AUTH === 'true'
  )
}
