'use client'

import { useState } from 'react'

type OwnerProofIntentControlProps = {
  capability: string
  defaultIntent: string
  runLabel?: string
  runTestId?: string
  disabled?: boolean
  onRun: (intent: string) => void | Promise<void>
}

/**
 * Visible user-intent control for owner-proof screenshots.
 * Structured intelligence remains primary; this makes the question visible.
 */
export function OwnerProofIntentControl({
  capability,
  defaultIntent,
  runLabel = 'Analyze',
  runTestId = 'intelligence-owner-proof-run',
  disabled,
  onRun,
}: OwnerProofIntentControlProps) {
  const [intent, setIntent] = useState(defaultIntent)

  return (
    <div className="space-y-2" data-testid="intelligence-owner-proof-intent-wrap" data-capability={capability}>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">Your question</span>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
          data-testid="intelligence-owner-proof-intent"
          aria-label="Owner-proof intelligence question"
        />
      </label>
      <button
        type="button"
        disabled={disabled || !intent.trim()}
        className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        data-testid={runTestId}
        onClick={() => void onRun(intent.trim())}
      >
        {runLabel}
      </button>
    </div>
  )
}
