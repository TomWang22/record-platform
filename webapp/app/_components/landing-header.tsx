'use client'

import Link from 'next/link'

const navLinks = [
  { href: '#collectors', label: 'Collectors' },
  { href: '#sellers', label: 'Sellers' },
  { href: '#catalog-intelligence', label: 'Catalog' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#integrations', label: 'Integrations' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
]

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-white">
            RP
          </span>
          <span className="hidden text-sm font-semibold text-slate-900 dark:text-white sm:inline">
            Record Platform
          </span>
        </Link>
        <nav className="hidden flex-wrap items-center justify-end gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-200/80 bg-white px-4 py-10 dark:border-white/10 dark:bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Record Platform — Catalog Intelligence
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link href="/about" className="text-slate-600 hover:text-brand dark:text-slate-400">
            About
          </Link>
          <Link href="/privacy" className="text-slate-600 hover:text-brand dark:text-slate-400">
            Privacy
          </Link>
          <Link href="/terms" className="text-slate-600 hover:text-brand dark:text-slate-400">
            Terms
          </Link>
          <Link href="/listings" className="text-slate-600 hover:text-brand dark:text-slate-400">
            Browse listings
          </Link>
        </div>
      </div>
    </footer>
  )
}
