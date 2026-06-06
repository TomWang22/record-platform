'use client'

import type { DevSessionProfile } from './dev-auth'

const SESSION_TOKEN_KEY = 'record-platform.token'
const DEV_PROFILE_KEY = 'record-platform.dev-profile'
const CONTRACT_PROFILE_KEY = 'record-platform.contract-profile'

export type ContractSessionProfile = {
  name?: string
  email?: string
  avatarUrl?: string
  initials: string
  provider?: 'google' | 'discogs' | 'local' | 'dev'
}

export type { DevSessionProfile }

export function getClientSessionToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SESSION_TOKEN_KEY)
}

export function persistSessionToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SESSION_TOKEN_KEY, token)
}

export function clearSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(SESSION_TOKEN_KEY)
  window.localStorage.removeItem(DEV_PROFILE_KEY)
  window.localStorage.removeItem(CONTRACT_PROFILE_KEY)
}

export function persistDevSessionProfile(profile: DevSessionProfile) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DEV_PROFILE_KEY, JSON.stringify(profile))
}

export function getDevSessionProfile(): DevSessionProfile | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(DEV_PROFILE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DevSessionProfile
  } catch {
    return null
  }
}

/** Playwright contract auth overlay (see e2e/helpers/auth.ts signInWithToken). */
export function getContractSessionProfile(): ContractSessionProfile | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(CONTRACT_PROFILE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContractSessionProfile
  } catch {
    return null
  }
}

