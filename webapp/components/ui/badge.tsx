'use client'

import { HTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

const variants = {
  default: 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  primary: 'bg-brand/10 text-brand dark:bg-brand/20',
  success: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-400',
  danger: 'bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-400',
  info: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-400',
  outline: 'border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300',
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'default', ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
})

