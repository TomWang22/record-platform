import type { SessionUser } from './use-session'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function looksLikeUuid(value: string | undefined): boolean {
  const s = String(value ?? '').trim()
  return s.length > 0 && UUID_RE.test(s)
}

/** Contract users: displayName → username → email local-part → never raw UUID as primary. */
export function resolveSessionDisplayName(input: {
  name?: string
  displayName?: string
  username?: string
  email?: string
  sub?: string
}): string | undefined {
  const displayName = String(input.displayName ?? input.name ?? '').trim()
  if (displayName && !looksLikeUuid(displayName)) return displayName

  const username = String(input.username ?? '').trim()
  if (username && !looksLikeUuid(username)) return username

  const email = String(input.email ?? '').trim()
  if (email.includes('@')) {
    const local = email.split('@')[0]?.replace(/\+.*/, '').trim()
    if (local) return local
  }

  const sub = String(input.sub ?? '').trim()
  if (sub && looksLikeUuid(sub)) return undefined
  if (sub) return sub.slice(0, 8)

  return undefined
}

export function authProviderLabel(provider: SessionUser['provider']): string {
  switch (provider) {
    case 'google':
      return 'Google'
    case 'discogs':
      return 'Discogs'
    case 'dev':
      return 'Dev'
    default:
      return 'Email'
  }
}

export function sessionPrimaryLabel(user: SessionUser): string {
  return (
    resolveSessionDisplayName({
      name: user.name,
      email: user.email,
    }) ??
    user.email ??
    'Account'
  )
}
