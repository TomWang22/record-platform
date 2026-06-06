'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { authProviderLabel, sessionPrimaryLabel } from '@/lib/session-display'
import {
  fetchProfileDashboardStats,
  type ProfileDashboardStats,
} from '@/lib/profile-dashboard-stats'
import { useRequireAuth } from '@/lib/use-require-auth'
import { useSession, isSessionAuthenticated } from '@/lib/use-session'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 4) return `${local[0] ?? ''}***@${domain}`
  return `${local.slice(0, 4)}***@${domain}`
}

type StatDef = {
  label: string
  value: string | number
  helper?: string
  href: string
  testId: string
}

function ProfileStatCard({ stat }: { stat: StatDef }) {
  return (
    <Link href={stat.href} className="group block" data-testid={stat.testId}>
      <Card className="transition hover:border-brand/40 hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p
              className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white"
              data-testid={`${stat.testId}-value`}
            >
              {stat.value}
            </p>
            {stat.helper && (
              <p className="mt-0.5 text-xs text-slate-500" data-testid={`${stat.testId}-helper`}>
                {stat.helper}
              </p>
            )}
          </div>
          <span
            className="shrink-0 text-sm font-medium text-brand opacity-80 group-hover:opacity-100"
            data-testid={`${stat.testId}-link`}
          >
            View →
          </span>
        </div>
      </Card>
    </Link>
  )
}

export default function ProfilePage() {
  const { authRequired } = useRequireAuth()
  const session = useSession()
  const [stats, setStats] = useState<ProfileDashboardStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    if (authRequired) return
    setStatsLoading(true)
    void fetchProfileDashboardStats()
      .then(setStats)
      .catch(() =>
        setStats({
          recordsCount: 0,
          feedbackScore: '—',
          activeListings: 0,
          soldListings: 0,
          purchasesCount: 0,
          uniqueArtists: 0,
          totalSpendDisplay: '—',
        }),
      )
      .finally(() => setStatsLoading(false))
  }, [authRequired])

  if (authRequired) {
    return <AuthRequiredCard title="Sign in to view your profile" returnTo="/profile" />
  }

  const user = isSessionAuthenticated(session) ? session.user : null
  const displayEmail = user?.email ? maskEmail(user.email) : null

  const statCards: StatDef[] = stats
    ? [
        {
          label: 'Records',
          value: stats.recordsCount,
          href: '/records',
          testId: 'profile-stat-records',
        },
        {
          label: 'Selling',
          value: stats.activeListings,
          href: '/profile/selling',
          testId: 'profile-stat-selling',
        },
        {
          label: 'Purchases',
          value: stats.purchasesCount,
          href: '/profile/purchases',
          testId: 'profile-stat-purchases',
        },
        {
          label: 'Feedback score',
          value: stats.feedbackScore,
          href: '/profile/feedback',
          testId: 'profile-stat-feedback',
        },
        {
          label: 'Active listings',
          value: stats.activeListings,
          href: '/profile/selling?status=active',
          testId: 'profile-stat-active-listings',
        },
        {
          label: 'Sold listings',
          value: stats.soldListings,
          href: '/profile/selling?status=sold',
          testId: 'profile-stat-sold-listings',
        },
        {
          label: 'Collection stats',
          value: stats.uniqueArtists > 0 ? stats.uniqueArtists : stats.recordsCount,
          helper:
            stats.recordsCount > 0
              ? `${stats.recordsCount} records · ${stats.totalSpendDisplay} spent`
              : 'Add records to unlock charts',
          href: '/profile/collection-stats',
          testId: 'profile-stat-collection-stats',
        },
      ]
    : []

  return (
    <div className="space-y-6" data-testid="profile-page-ready">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-xl font-bold text-white">
            {user?.initials ?? 'U'}
          </div>
          <div>
            <p className="text-lg font-semibold" data-testid="profile-display-name">
              {user ? sessionPrimaryLabel(user) : 'Collector'}
            </p>
            {displayEmail && (
              <p className="text-sm text-slate-500" data-testid="profile-email">
                {displayEmail}
              </p>
            )}
            {user?.provider && (
              <p className="text-xs text-slate-500" data-testid="profile-sign-in-provider">
                Signed in with {authProviderLabel(user.provider)}
              </p>
            )}
          </div>
        </div>
      </Card>

      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="profile-stats-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statCards.map((stat) => (
            <ProfileStatCard key={stat.testId} stat={stat} />
          ))}
        </div>
      )}
    </div>
  )
}
