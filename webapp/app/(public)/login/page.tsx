'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'
import { persistSessionToken } from '@/lib/session'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function authenticate(mode: 'login' | 'register') {
    setBusy(true)
    setMessage('')
    try {
      const data = await apiFetch<{ token: string }>(`/auth/${mode}`, {
        method: 'POST',
        data: { email, password },
      })
      persistSessionToken(data.token)
      router.replace('/records')
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message || 'Unable to authenticate')
      } else {
        setMessage('Unexpected error')
      }
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void authenticate('login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-16 dark:from-slate-950 dark:to-slate-900">
      <Card
        title="Sign in"
        description="Enter your credentials to access the dashboard."
        className="w-full max-w-md"
      >
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
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
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <div className="flex gap-3">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              className="flex-1"
              onClick={() => void authenticate('register')}
            >
              Register
            </Button>
          </div>
        </form>
        {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}
      </Card>
    </div>
  )
}

