'use client'

import { ApiError } from '@/lib/api-client'
import { Button } from './button'

type ApiErrorAlertProps = {
  title?: string
  error: unknown
  onRetry?: () => void
}

export function ApiErrorAlert({
  title = 'Request failed',
  error,
  onRetry,
}: ApiErrorAlertProps) {
  const isApiError = error instanceof ApiError
  const message = error instanceof Error ? error.message : 'An unknown error occurred'
  const status = isApiError ? error.details.status : undefined
  const path = isApiError ? error.details.path : undefined

  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200/80 bg-rose-50 p-4 text-sm dark:border-rose-900/50 dark:bg-rose-950/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-rose-700 dark:text-rose-400">{title}</p>
          <p className="mt-1 text-rose-600 dark:text-rose-400/80">{message}</p>
          {(status || path) && (
            <p className="mt-1 text-xs text-rose-500/70 dark:text-rose-500/50">
              {status && `Status ${status}`}
              {status && path && ' · '}
              {path && `${path}`}
            </p>
          )}
          {process.env.NODE_ENV !== 'production' && isApiError && error.details.body && (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-rose-100/50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-400/70">
              {error.details.body}
            </pre>
          )}
        </div>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="flex-shrink-0 text-rose-600">
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
