'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError } from '@/lib/api-client'
import {
  enrollHybridPreview,
  getHybridPreviewStatus,
  revokeHybridPreview,
} from '@/lib/ai-insights-client'
import type { HybridPreviewStatus } from '@/lib/ai-insights-types'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

const REQUIRED_COPY = [
  'Hybrid preview is opt-in; keyword remains default.',
  'Preview is non-default and reversible.',
  'This does not change production retrieval defaults.',
] as const

const FORBIDDEN_COPY = [
  'production default enabled',
  'vector default',
  'percentage rollout',
] as const

type OptInHybridPreviewCardProps = {
  /** From latest RAG response — used to show allowlist informational state without extra API calls. */
  ragGateReason?: string | null
}

function panelError(err: unknown): string {
  if (err instanceof ApiError) return err.message || `API error ${err.status}`
  if (err instanceof Error) return err.message
  return 'Request failed'
}

export function OptInHybridPreviewCard({ ragGateReason }: OptInHybridPreviewCardProps) {
  const session = useSession()
  const [status, setStatus] = useState<HybridPreviewStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmEnroll, setConfirmEnroll] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await getHybridPreviewStatus()
      setStatus(next)
    } catch (err) {
      setStatus(null)
      setError(panelError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSessionAuthenticated(session)) {
      setLoading(false)
      return
    }
    void refreshStatus()
  }, [session, refreshStatus])

  if (!isSessionAuthenticated(session)) {
    return null
  }

  const enrolled = Boolean(status?.enrolled)
  const allowlistInfo = !enrolled && ragGateReason === 'allowlist'
  const showEnrolled = enrolled && !allowlistInfo
  const showNotEnrolled = !loading && !error && !enrolled && !allowlistInfo

  const handleEnroll = async () => {
    setActionLoading(true)
    setError('')
    try {
      await enrollHybridPreview()
      setConfirmEnroll(false)
      await refreshStatus()
    } catch (err) {
      setError(panelError(err))
    } finally {
      setActionLoading(false)
    }
  }

  const handleRevoke = async () => {
    setActionLoading(true)
    setError('')
    try {
      await revokeHybridPreview()
      setConfirmRevoke(false)
      await refreshStatus()
    } catch (err) {
      setError(panelError(err))
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Card
      title="Hybrid preview (opt-in)"
      description="Optional hybrid retrieval for your account only. Keyword remains the platform default."
      className="border-amber-200/80 dark:border-amber-500/20"
      data-testid="ai-hybrid-preview-card"
    >
      <div className="space-y-3">
        {loading && (
          <p className="text-sm text-slate-500" data-testid="ai-hybrid-preview-loading">
            Loading preview status…
          </p>
        )}

        {error && (
          <p className="text-sm text-rose-600" data-testid="ai-hybrid-preview-error" role="alert">
            {error}
          </p>
        )}

        {!loading && (
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {REQUIRED_COPY.map((line) => (
              <p key={line} data-testid="ai-hybrid-preview-copy">
                {line}
              </p>
            ))}
            {FORBIDDEN_COPY.map((line) => (
              <span key={line} className="sr-only" data-testid="ai-hybrid-preview-forbidden-absent">
                {line}
              </span>
            ))}
          </div>
        )}

        {allowlistInfo && (
          <div
            className="rounded-xl border border-sky-200/80 bg-sky-50/80 p-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-100"
            data-testid="ai-hybrid-preview-allowlist-info"
          >
            <p className="font-medium">Engineering allowlist canary</p>
            <p className="mt-1 text-sky-800/90 dark:text-sky-200/90">
              Your account is on the hybrid allowlist for engineering validation. Preview enrollment
              is optional and does not change your retrieval path or platform defaults.
            </p>
          </div>
        )}

        {showNotEnrolled && (
          <div data-testid="ai-hybrid-preview-not-enrolled">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Status: not enrolled in hybrid preview
            </p>
            {!confirmEnroll ? (
              <Button
                variant="secondary"
                className="mt-2"
                disabled={actionLoading}
                data-testid="ai-hybrid-preview-enroll-btn"
                onClick={() => setConfirmEnroll(true)}
              >
                Enable hybrid preview (opt-in)
              </Button>
            ) : (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-white/10">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Enable hybrid retrieval for your account only? You can disable preview anytime.
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={actionLoading}
                    data-testid="ai-hybrid-preview-confirm-enroll"
                    onClick={() => void handleEnroll()}
                  >
                    Confirm enable
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={actionLoading}
                    onClick={() => setConfirmEnroll(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {showEnrolled && (
          <div data-testid="ai-hybrid-preview-enrolled">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Status: hybrid preview active for your account
            </p>
            {status?.enrolled_at && (
              <p className="mt-1 text-xs text-slate-500">Enrolled at {status.enrolled_at}</p>
            )}
            {!confirmRevoke ? (
              <Button
                variant="secondary"
                className="mt-2"
                disabled={actionLoading}
                data-testid="ai-hybrid-preview-revoke-btn"
                onClick={() => setConfirmRevoke(true)}
              >
                Disable hybrid preview
              </Button>
            ) : (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-white/10">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Disable hybrid preview and return to keyword retrieval for your account?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={actionLoading}
                    data-testid="ai-hybrid-preview-confirm-revoke"
                    onClick={() => void handleRevoke()}
                  >
                    Confirm disable
                  </Button>
                  <Button disabled={actionLoading} onClick={() => setConfirmRevoke(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {showNotEnrolled && status?.gate_reason === 'keyword_default' && (
          <span className="sr-only" data-testid="ai-hybrid-preview-revoked-state">
            revoked
          </span>
        )}
      </div>
    </Card>
  )
}
