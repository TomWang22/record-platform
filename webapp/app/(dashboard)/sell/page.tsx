'use client'

import { Suspense } from 'react'

import { SellListWorkflow } from '@/components/sell/sell-list-workflow'

export default function SellPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <SellListWorkflow returnTo="/sell" />
    </Suspense>
  )
}
