'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'
import { isDevAuthEnabled } from '@/lib/dev-auth'
import { persistDevSessionProfile, persistSessionToken } from '@/lib/session'
import {
  contractProfileFromJwtPayload,
  persistContractSessionProfile,
} from '@/lib/session-profile'

export default function LoginPage() {
  const router = useRouter()
  const devAuthEnabled = isDevAuthEnabled()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleDevLogin() {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/dev-auth/login', { method: 'POST' })
      const data = (await res.json()) as {
        token?: string
        profile?: { name: string; email: string; initials: string; provider: 'google' }
        error?: string
      }
      if (!res.ok || !data.token) {
        throw new Error(data.error ?? 'Dev login failed')
      }
      persistSessionToken(data.token)
      if (data.profile) {
        persistDevSessionProfile(data.profile)
      }
      router.replace('/dashboard')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Dev login failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const data = await apiFetch<{ token: string }>('/auth/login', {
        method: 'POST',
        data: { email, password },
      })
      persistSessionToken(data.token)
      try {
        const parts = data.token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]!)) as Record<string, unknown>
          const profile = contractProfileFromJwtPayload({ ...payload, email: payload.email ?? email })
          if (profile) persistContractSessionProfile(profile)
        }
      } catch {
        /* non-fatal */
      }
      router.replace('/dashboard')
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message || 'Unable to sign in. Please check your credentials.')
      } else {
        setMessage('An unexpected error occurred. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-16 dark:from-slate-950 dark:to-slate-900">
      <Card
        title="Sign in"
        description="Enter your credentials to access your account."
        className="w-full max-w-md"
      >
        <form className="space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {devAuthEnabled && (
          <div className="mt-4 border-t border-slate-200/80 pt-4 dark:border-white/10">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              className="w-full"
              onClick={() => void handleDevLogin()}
            >
              Continue as Test Collector
            </Button>
            <p className="mt-2 text-center text-xs text-slate-500">
              Dev auth only — not available in production unless explicitly enabled.
            </p>
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-xl border border-rose-200/80 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-400">
            {message}
          </div>
        )}

        <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          Don't have an account?{' '}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Create one here
          </Link>
        </div>
      </Card>
    </div>
  )
}

