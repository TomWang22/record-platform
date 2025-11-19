'use client'

const SESSION_TOKEN_KEY = 'record-platform.token'

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
}

