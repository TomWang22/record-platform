'use client'

import { Slot } from '@radix-ui/react-slot'
import { ButtonHTMLAttributes, forwardRef } from 'react'

import { cn } from '@/lib/utils'

const variants = {
  primary: 'bg-brand text-white hover:bg-indigo-500',
  secondary: 'bg-slate-900/5 text-slate-900 hover:bg-slate-900/10 dark:text-slate-100 dark:bg-white/5',
  ghost: 'bg-transparent hover:bg-slate-900/5 dark:hover:bg-white/5',
}

const sizes = {
  sm: 'px-2 py-1 text-xs',
  default: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'default', asChild, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
})

