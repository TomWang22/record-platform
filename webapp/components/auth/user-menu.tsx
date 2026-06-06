'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { clearSession } from '@/lib/session'
import type { SessionUser } from '@/lib/use-session'
import { sessionPrimaryLabel } from '@/lib/session-display'
import { useSession, isSessionAuthenticated } from '@/lib/use-session'

function UserAvatar({ user }: { user: SessionUser }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name ?? 'User'}
        className="h-9 w-9 rounded-full object-cover ring-2 ring-white dark:ring-slate-900"
      />
    )
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
      {user.initials}
    </div>
  )
}

const providerLabel: Record<SessionUser['provider'], string> = {
  google: 'Google',
  discogs: 'Discogs',
  local: 'Local',
  dev: 'Dev',
}

export function UserMenu() {
  const router = useRouter()
  const session = useSession()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function logout() {
    clearSession()
    setOpen(false)
    router.replace('/login')
  }

  if (session.status === 'loading') {
    return <div className="h-9 w-20 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
  }

  if (!isSessionAuthenticated(session)) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600 dark:border-white/20 dark:bg-slate-900 dark:text-slate-300"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            G
          </span>
          Guest
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg dark:border-white/10 dark:bg-slate-950"
          >
            <Link
              href="/login"
              role="menuitem"
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              role="menuitem"
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
              onClick={() => setOpen(false)}
            >
              Create account
            </Link>
          </div>
        )}
      </div>
    )
  }

  const { user } = session

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 py-1 pl-1 pr-3 text-left shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/80 dark:hover:bg-slate-800"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <UserAvatar user={user} />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium text-slate-900 dark:text-white sm:inline">
          {sessionPrimaryLabel(user)}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg dark:border-white/10 dark:bg-slate-950"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-white/10">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {sessionPrimaryLabel(user)}
            </p>
            {user.email && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
            )}
            <span className="mt-2 inline-block text-[10px] text-slate-500 dark:text-slate-400">
              Signed in with {providerLabel[user.provider] === 'Local' ? 'Email' : providerLabel[user.provider]}
            </span>
          </div>
          <Link
            href="/profile"
            role="menuitem"
            className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={logout}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
