const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function maskEmail(email: string | null | undefined): string {
  const raw = String(email ?? '').trim()
  if (!raw.includes('@')) return ''
  const [local, domain] = raw.split('@')
  if (!local || !domain) return ''
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

export function participantLabel(input: {
  displayName?: string | null
  username?: string | null
  email?: string | null
}): string {
  const display = String(input.displayName ?? '').trim()
  if (display && !UUID_RE.test(display)) return display
  const username = String(input.username ?? '')
    .trim()
    .replace(/^@+/, '')
  if (username && !UUID_RE.test(username)) return username.startsWith('@') ? username : `@${username}`
  const masked = maskEmail(input.email)
  if (masked) return masked
  return 'Member'
}

export function isUuidLike(value: string | null | undefined): boolean {
  return UUID_RE.test(String(value ?? '').trim())
}
