'use client'

import { Suspense } from 'react'

import { SellListWorkflow } from '@/components/sell/sell-list-workflow'

/** Legacy path — same listing workflow as /sell */
export default function MarketPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <SellListWorkflow returnTo="/market" />
    </Suspense>
  )
}
