export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getUserIdFromToken(token: string | null | undefined): string | null {
  if (!token) return null
  const payload = parseJwtPayload(token)
  const sub = String(payload?.sub ?? payload?.user_id ?? '').trim()
  return sub || null
}
