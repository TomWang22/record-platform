'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  getClientSessionToken,
  getContractSessionProfile,
  getDevSessionProfile,
} from './session'
import { isDevAuthEnabled } from './dev-auth'
import { resolveSessionDisplayName } from './session-display'

export type SessionUser = {
  name?: string
  email?: string
  avatarUrl?: string
  initials: string
  provider: 'google' | 'discogs' | 'local' | 'dev'
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: SessionUser; token: string }

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }
}

function initialsFrom(name?: string, email?: string): string {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
  if (email?.[0]) return email[0].toUpperCase()
  return 'U'
}

function providerFrom(payload: Record<string, unknown>): SessionUser['provider'] {
  const raw = String(payload.provider ?? payload.auth_provider ?? payload.iss ?? '').toLowerCase()
  if (raw.includes('dev')) return 'dev'
  if (raw.includes('google')) return 'google'
  if (raw.includes('discogs')) return 'discogs'
  return 'local'
}

function userFromToken(token: string): SessionUser {
  const payload = parseJwtPayload(token) ?? {}
  const email = payload.email as string | undefined
  const name = resolveSessionDisplayName({
    name: payload.name as string | undefined,
    displayName: payload.display_name as string | undefined,
    username: payload.username as string | undefined,
    email,
    sub: payload.sub as string | undefined,
  })
  const avatarUrl = (payload.picture ?? payload.avatar_url) as string | undefined
  return {
    name,
    email,
    avatarUrl,
    initials: initialsFrom(name, email),
    provider: providerFrom(payload),
  }
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  const refresh = useCallback(() => {
    const token = getClientSessionToken()
    if (!token) {
      setState({ status: 'unauthenticated' })
      return
    }
    const baseUser = userFromToken(token)
    const devProfile = isDevAuthEnabled() ? getDevSessionProfile() : null
    const contractProfile = getContractSessionProfile()
    const overlay = contractProfile ?? devProfile
    const merged = overlay
      ? {
          ...baseUser,
          name: overlay.name ?? baseUser.name,
          email: overlay.email ?? baseUser.email,
          avatarUrl: overlay.avatarUrl ?? baseUser.avatarUrl,
          initials: overlay.initials ?? baseUser.initials,
          provider:
            (overlay.provider as SessionUser['provider'] | undefined) ?? baseUser.provider,
        }
      : baseUser
    const displayName = resolveSessionDisplayName({
      name: merged.name,
      email: merged.email,
    })
    setState({
      status: 'authenticated',
      token,
      user: {
        ...merged,
        name: displayName ?? merged.name,
        initials: initialsFrom(displayName ?? merged.name, merged.email),
      },
    })
  }, [])

  useEffect(() => {
    refresh()
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === 'record-platform.token' ||
        event.key === 'record-platform.contract-profile'
      ) {
        refresh()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])

  return state
}

export function isSessionAuthenticated(session: SessionState): session is Extract<
  SessionState,
  { status: 'authenticated' }
> {
  return session.status === 'authenticated'
}
