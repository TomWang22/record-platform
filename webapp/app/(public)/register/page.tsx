'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { PasswordStrengthIndicator, calculatePasswordStrength } from '@/components/auth/PasswordStrength'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'
import { persistSessionToken } from '@/lib/session'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function validateForm(): string | null {
    if (!email || !password || !confirmPassword) {
      return 'All fields are required'
    }
    
    const strength = calculatePasswordStrength(password)
    if (strength.score < 40) {
      return 'Password is too weak. Please use a stronger password.'
    }
    
    if (password !== confirmPassword) {
      return 'Passwords do not match'
    }
    return null
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    
    const validationError = validateForm()
    if (validationError) {
      setMessage(validationError)
      return
    }

    setBusy(true)
    setMessage('')
    try {
      const data = await apiFetch<{ token: string }>('/auth/register', {
        method: 'POST',
        data: { email, password },
      })
      persistSessionToken(data.token)
      router.replace('/dashboard')
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setMessage('An account with this email already exists. Please sign in instead.')
        } else {
          setMessage(error.message || 'Unable to create account. Please try again.')
        }
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
        title="Create an account"
        description="Sign up to start managing your record collection."
        className="w-full max-w-md"
      >
        <form className="space-y-4" onSubmit={handleRegister}>
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
              autoComplete="new-password"
              placeholder="Create a strong password"
              minLength={8}
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            {password && (
              <div className="mt-2">
                <PasswordStrengthIndicator password={password} />
              </div>
            )}
          </label>

          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className="mt-1 w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
            />
            {confirmPassword && password !== confirmPassword && (
              <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                Passwords do not match
              </p>
            )}
          </label>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        {message && (
          <div className={`mt-4 rounded-xl border p-3 text-sm ${
            message.includes('already exists') || message.includes('do not match') || message.includes('required')
              ? 'border-rose-200/80 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-400'
              : 'border-emerald-200/80 bg-emerald-50 text-emerald-600 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-400'
          }`}>
            {message}
          </div>
        )}

        <div className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in here
          </Link>
        </div>
      </Card>
    </div>
  )
}

