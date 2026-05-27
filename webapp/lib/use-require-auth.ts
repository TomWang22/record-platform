'use client'

import { useCallback, useEffect, useState } from 'react'

import { ApiError } from './api-client'
import { isSessionAuthenticated, useSession } from './use-session'

/**
 * Gate protected dashboard pages: never redirect to /login on 401.
 * Show AuthRequiredCard inside the existing AppShell instead.
 */
export function useRequireAuth() {
  const session = useSession()
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => {
    if (session.status === 'unauthenticated') {
      setAuthRequired(true)
    }
    if (session.status === 'authenticated') {
      setAuthRequired(false)
    }
  }, [session.status])

  const onApiError = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) {
      setAuthRequired(true)
      return true
    }
    return false
  }, [])

  return {
    session,
    authRequired,
    setAuthRequired,
    onApiError,
    isSignedIn: isSessionAuthenticated(session),
    isReady: session.status !== 'loading',
  }
}
