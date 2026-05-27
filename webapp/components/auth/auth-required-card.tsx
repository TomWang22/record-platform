import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type AuthRequiredCardProps = {
  title: string
  description?: string
  actionLabel?: string
  returnTo?: string
}

export function AuthRequiredCard({
  title,
  description = 'Sign in to use this part of Record Platform.',
  actionLabel = 'Sign in',
  returnTo,
}: AuthRequiredCardProps) {
  const loginHref = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/login'

  return (
    <Card className="mx-auto max-w-lg border-dashed border-brand/30 bg-brand/5 dark:bg-brand/10">
      <div className="space-y-4 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-brand">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href={loginHref}>{actionLabel}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/register">Create account</Link>
          </Button>
        </div>
      </div>
    </Card>
  )
}
