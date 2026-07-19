'use client'

import { useState } from 'react'

type OwnerProofIntentControlProps = {
  capability: string
  defaultIntent: string
  runLabel?: string
  runTestId?: string
  intentTestId?: string
  disabled?: boolean
  onRun: (intent: string) => void | Promise<void>
}

function capabilitySlug(capability: string): string {
  return capability.replace(/_/g, '-')
}

/**
 * Visible user-intent control for owner-proof screenshots.
 * Structured intelligence remains primary; this makes the question visible.
 *
 * Defaults are capability-scoped so listing pages that mount valuation + scarcity
 * (and other co-mounted panels) never share the same Analyze button test id.
 */
export function OwnerProofIntentControl({
  capability,
  defaultIntent,
  runLabel = 'Analyze',
  runTestId,
  intentTestId,
  disabled,
  onRun,
}: OwnerProofIntentControlProps) {
  const [intent, setIntent] = useState(defaultIntent)
  const slug = capabilitySlug(capability)
  const resolvedRunTestId = runTestId ?? `intelligence-${slug}-run`
  const resolvedIntentTestId = intentTestId ?? `intelligence-${slug}-intent`

  return (
    <div
      className="space-y-2"
      data-testid="intelligence-owner-proof-intent-wrap"
      data-capability={capability}
      data-owner-proof-run-testid={resolvedRunTestId}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">Your question</span>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
          data-testid={resolvedIntentTestId}
          data-owner-proof-intent="1"
          aria-label="Owner-proof intelligence question"
        />
      </label>
      <button
        type="button"
        disabled={disabled || !intent.trim()}
        className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        data-testid={resolvedRunTestId}
        data-owner-proof-action="1"
        onClick={() => {
          if (typeof window !== 'undefined') {
            const w = window as Window & {
              __OWNER_PROOF_HANDLER_REACHED__?: {
                capability: string
                runTestId: string
                at: number
              }
            }
            w.__OWNER_PROOF_HANDLER_REACHED__ = {
              capability,
              runTestId: resolvedRunTestId,
              at: Date.now(),
            }
          }
          void onRun(intent.trim())
        }}
      >
        {runLabel}
      </button>
    </div>
  )
}
