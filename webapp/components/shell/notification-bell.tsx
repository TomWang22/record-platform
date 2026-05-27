'use client'

import Link from 'next/link'

/** Placeholder until notification-service UI is wired (Phase H). */
export function NotificationBell() {
  return (
    <Link
      href="/settings"
      className="relative rounded-full border border-slate-200/80 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
      aria-label="Notifications (preferences)"
      title="Notifications coming soon"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    </Link>
  )
}
