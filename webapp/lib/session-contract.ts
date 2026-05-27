'use client'

import { isDevAuthEnabled } from './dev-auth'
import { getDevSessionProfile } from './session'
import type { SessionState } from './use-session'
import { isSessionAuthenticated } from './use-session'

/** Canonical browser session kinds for UI contract tests. */
export type AppSessionKind =
  | 'guest'
  | 'dev-authenticated'
  | 'real-authenticated'
  | 'expired'
  | 'error'

export function resolveAppSessionKind(session: SessionState): AppSessionKind {
  if (session.status === 'loading') return 'guest'
  if (session.status === 'unauthenticated') return 'guest'

  const devProfile = isDevAuthEnabled() ? getDevSessionProfile() : null
  if (devProfile?.provider === 'dev') {
    return 'dev-authenticated'
  }
  return 'real-authenticated'
}

export function isGuestSession(session: SessionState): boolean {
  return resolveAppSessionKind(session) === 'guest'
}

export function isAuthenticatedSession(session: SessionState): boolean {
  const kind = resolveAppSessionKind(session)
  return kind === 'dev-authenticated' || kind === 'real-authenticated'
}

export function shouldShowAuthRequiredCard(session: SessionState, authRequiredFlag: boolean): boolean {
  if (!isSessionAuthenticated(session)) return true
  if (authRequiredFlag) return true
  return false
}

export function sessionDisplayName(session: SessionState): string | undefined {
  if (!isSessionAuthenticated(session)) return undefined
  return session.user.name ?? session.user.email
}
