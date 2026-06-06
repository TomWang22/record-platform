'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { sessionPrimaryLabel } from '@/lib/session-display'
import { useRequireAuth } from '@/lib/use-require-auth'
import { useSession, isSessionAuthenticated } from '@/lib/use-session'

export default function ProfilePage() {
  const { authRequired } = useRequireAuth()
  const session = useSession()
  const [recordsCount, setRecordsCount] = useState(0)

  useEffect(() => {
    if (!authRequired) {
      void apiFetch<unknown[]>('/api/records', { auth: true })
        .then((rows) => setRecordsCount(rows.length))
        .catch(() => setRecordsCount(0))
    }
  }, [authRequired])

  if (authRequired) {
    return <AuthRequiredCard title="Sign in to view your profile" returnTo="/profile" />
  }

  const user = isSessionAuthenticated(session) ? session.user : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-xl font-bold text-white">
            {user?.initials ?? 'U'}
          </div>
          <div>
            <p
              className="text-lg font-semibold"
              data-testid="profile-display-name"
            >
              {user ? sessionPrimaryLabel(user) : 'Collector'}
            </p>
            {user?.email && (
              <p className="text-sm text-slate-500" data-testid="profile-email">
                {user.email}
              </p>
            )}
            {user?.provider && (
              <p className="text-xs text-slate-500" data-testid="profile-sign-in-provider">
                Signed in with{' '}
                {user.provider === 'local'
                  ? 'Email'
                  : user.provider === 'google'
                    ? 'Google'
                    : user.provider === 'discogs'
                      ? 'Discogs'
                      : 'Test account'}
              </p>
            )}
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/records" className="block">
          <Card>
            <p className="text-xs text-slate-500">Records</p>
            <p className="text-2xl font-bold">{recordsCount}</p>
          </Card>
        </Link>
        <Link href="/profile/feedback" className="block">
          <Card>
            <p className="text-xs text-slate-500">Feedback score</p>
            <p className="text-2xl font-bold">—</p>
          </Card>
        </Link>
        <Link href="/profile/selling" className="block">
          <Card>
            <p className="text-xs text-slate-500">Active listings</p>
            <p className="text-2xl font-bold">—</p>
          </Card>
        </Link>
      </div>
      <nav className="flex flex-wrap gap-2">
        <Link href="/profile/selling" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5">Selling</Link>
        <Link href="/profile/purchases" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5">Purchases</Link>
        <Link href="/profile/feedback" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5">Feedback</Link>
        <Link href="/profile/collection-stats" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5">Collection stats</Link>
      </nav>
    </div>
  )
}
