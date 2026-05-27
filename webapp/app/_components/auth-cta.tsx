'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { getClientSessionToken } from '@/lib/session'

type LinkDef = {
  label: string
  href: string
  variant?: 'primary' | 'outline'
}

type AuthCtaProps = {
  guestLinks?: LinkDef[]
  authenticatedLinks?: LinkDef[]
}

const defaultGuestLinks: LinkDef[] = [
  { label: 'Get Started', href: '/register' },
  { label: 'Sign In', href: '/login', variant: 'outline' },
]

const defaultAuthLinks: LinkDef[] = [
  { label: 'Open Dashboard', href: '/dashboard' },
  { label: 'Browse Records', href: '/records', variant: 'outline' },
]

export function AuthCta({
  guestLinks = defaultGuestLinks,
  authenticatedLinks = defaultAuthLinks,
}: AuthCtaProps) {
  const [signedIn, setSignedIn] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setSignedIn(!!getClientSessionToken())
  }, [])

  if (!mounted) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-4">
        {guestLinks.map((l) => (
          <span key={l.href} className="h-11 w-32" />
        ))}
      </div>
    )
  }

  const links = signedIn ? authenticatedLinks : guestLinks

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            l.variant === 'outline'
              ? 'inline-flex items-center rounded-xl border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/20 dark:text-slate-300 dark:hover:bg-slate-800'
              : 'inline-flex items-center rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white transition hover:bg-brand/90'
          }
        >
          {l.label}
        </Link>
      ))}
    </div>
  )
}
