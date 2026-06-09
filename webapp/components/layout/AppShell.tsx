'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ReactNode } from 'react'

import { UserMenu } from '@/components/auth/user-menu'
import { CartIndicator } from '@/components/shell/cart-indicator'
import { NotificationDropdown } from '@/components/shell/notification-dropdown'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Button } from '@/components/ui/button'
import config from '@/lib/config'
import { clearSession } from '@/lib/session'
import { sessionPrimaryLabel } from '@/lib/session-display'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

import { NavLink } from './NavLink'

type AppShellProps = {
  children: ReactNode
}

const navItems = [
  { href: '/dashboard', label: 'My Collection' },
  { href: '/records', label: 'Records' },
  { href: '/market', label: 'Sell / List' },
  { href: '/offers/inbox', label: 'Offer inbox' },
  { href: '/offers/sent', label: 'Sent offers' },
  { href: '/auctions', label: 'Auction Monitor' },
  { href: '/forum', label: 'Forum' },
  { href: '/insights', label: 'Insights & AI' },
  { href: '/messages', label: 'Messages' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/observation-deck', label: 'Observation deck' },
  { href: '/settings', label: 'Settings' },
]

function SidebarUserCard() {
  const session = useSession()

  const signOut = () => {
    clearSession()
    window.location.href = '/login'
  }

  if (!isSessionAuthenticated(session)) {
    return (
      <Link
        href="/login"
        className="block w-full rounded-xl bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand/90"
      >
        Sign in
      </Link>
    )
  }
  const { user } = session
  return (
    <div className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10">
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name ?? 'User'}
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {user.initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-slate-900 dark:text-white"
            data-testid="sidebar-user-display-name"
          >
            {sessionPrimaryLabel(user)}
          </p>
          {user.email && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="mt-3 w-full rounded-lg border border-slate-200/70 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
      >
        Sign out
      </button>
    </div>
  )
}

export function AppShell({ children }: AppShellProps) {
  const session = useSession()
  const isSignedIn = isSessionAuthenticated(session)

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <aside className="hidden w-64 flex-col border-r border-slate-200/70 bg-white/80 px-6 py-6 text-sm dark:border-white/10 dark:bg-slate-950/40 lg:flex">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-white font-semibold">RP</div>
          <div>
            <p className="text-base font-semibold text-slate-900 dark:text-white">{config.appName}</p>
            <p className="text-xs text-slate-500">Catalog Intelligence</p>
          </div>
        </Link>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>

        <div className="mt-auto space-y-3 pt-6">
          <SidebarUserCard />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-transparent p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Image src="/favicon.ico" width={32} height={32} alt="" className="rounded-xl lg:hidden" />
            <div>
              <p className="text-sm text-slate-500">Dashboard</p>
              <p className="font-semibold text-slate-900 dark:text-white">Welcome back</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" className="hidden text-xs uppercase tracking-wide text-slate-500 lg:inline-flex">
              {isSignedIn ? 'Live mode' : 'Guest'}
            </Button>
            <ThemeToggle />
            <NotificationDropdown />
            <CartIndicator />
            <UserMenu />
          </div>
        </header>

        <main
          className="flex-1 px-4 py-6 sm:px-6 lg:px-10"
          data-testid="page-content"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

