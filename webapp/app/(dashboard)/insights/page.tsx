'use client'

import { Suspense } from 'react'

import { AiInsightsDashboard } from '@/components/ai/ai-insights-dashboard'

export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4" data-testid="ai-insights-dashboard-loading">
          <p className="text-sm text-slate-500">Loading AI insights…</p>
        </div>
      }
    >
      <AiInsightsDashboard />
    </Suspense>
  )
}
