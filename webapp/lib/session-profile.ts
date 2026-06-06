'use client'

import type { ContractSessionProfile } from './session'

const CONTRACT_PROFILE_KEY = 'record-platform.contract-profile'

export function persistContractSessionProfile(profile: ContractSessionProfile): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CONTRACT_PROFILE_KEY, JSON.stringify(profile))
}

export function contractProfileFromLogin(
  email: string,
  payload: Record<string, unknown>,
): ContractSessionProfile {
  const name = String(payload.name ?? payload.display_name ?? '').trim()
  const username = String(payload.username ?? '').trim()
  const resolved =
    name ||
    username ||
    email.split('@')[0]?.replace(/\+.*/, '').trim() ||
    'Collector'
  const initials = resolved
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return {
    name: resolved,
    email,
    initials: initials || 'U',
    provider: 'local',
  }
}

export function contractProfileFromJwtPayload(
  payload: Record<string, unknown>,
): ContractSessionProfile | null {
  const email = String(payload.email ?? '').trim()
  if (!email.includes('@')) return null
  return contractProfileFromLogin(email, payload)
}
