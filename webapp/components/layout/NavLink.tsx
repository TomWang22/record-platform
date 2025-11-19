'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

type NavLinkProps = {
  href: string
  label: string
}

export function NavLink({ href, label }: NavLinkProps) {
  const pathname = usePathname()
  const active = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-brand/10 text-slate-900 dark:text-white'
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/5 dark:text-slate-400',
      )}
    >
      <span className="shrink-0 h-2 w-2 rounded-full bg-brand" aria-hidden />
      {label}
    </Link>
  )
}












