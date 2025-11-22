'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ReactNode } from 'react'

import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Button } from '@/components/ui/button'
import config from '@/lib/config'
import { clearSession } from '@/lib/session'
import { cn } from '@/lib/utils'

import { NavLink } from './NavLink'

type AppShellProps = {
  children: ReactNode
}

const navItems = [
  { href: '/dashboard', label: 'My Collection' },
  { href: '/records', label: 'Records' },
  { href: '/market', label: 'Sell / List' },
  { href: '/auctions', label: 'Auction Monitor' },
  { href: '/forum', label: 'Forum' },
  { href: '/insights', label: 'Insights & AI' },
  { href: '/messages', label: 'Messages' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/settings', label: 'Settings' },
]

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()

  function logout() {
    clearSession()
    router.replace('/login')
  }

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

        <div className="mt-auto space-y-4 pt-6">
          <div className="rounded-xl border border-slate-200/70 p-4 dark:border-white/10">
            <p className="text-xs uppercase tracking-wide text-slate-400">Kafka</p>
            <p className={cn('text-sm font-semibold text-emerald-600', 'dark:text-emerald-400')}>Placeholder</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Streaming status</p>
          </div>
          <Button variant="secondary" onClick={logout} className="w-full">
            Sign out
          </Button>
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
              Live mode
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  )
}

