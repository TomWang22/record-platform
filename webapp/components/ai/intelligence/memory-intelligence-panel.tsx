'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { forgetIntelligenceMemory, IntelligenceHttpError, resolveIntelligenceMemory } from '@/lib/ai-intelligence-client'
import { assembleMemoryRequest, buildMemoryCorrection, type IntelligenceMemoryItem } from '@/lib/ai-memory-assembler'

export function MemoryIntelligencePanel({ principalId, threadId }: { principalId: string | null; threadId: string | null }) {
  const [items, setItems] = useState<IntelligenceMemoryItem[]>([])
  const [state, setState] = useState<{ loading: boolean; error: string | null; rateLimited: boolean; result: Record<string, unknown> | null }>({ loading: false, error: null, rateLimited: false, result: null })
  async function resolve() {
    if (!principalId || !threadId) return
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await resolveIntelligenceMemory(assembleMemoryRequest({ principalId, threadId, memoryItems: items }))
      setState({ loading: false, error: null, rateLimited: false, result: (response.result || {}) as Record<string, unknown> })
    } catch (error) { setState({ loading: false, error: error instanceof Error ? error.message : 'Memory request failed', rateLimited: error instanceof IntelligenceHttpError && error.rateLimited, result: null }) }
  }
  async function forget(memoryId: string) {
    if (!principalId || !threadId) return
    await forgetIntelligenceMemory({ ...assembleMemoryRequest({ principalId, threadId, memoryItems: items }), operation: 'forget', forget_memory_ids: [memoryId] })
    setItems((current) => current.filter((item) => item.memory_id !== memoryId))
    await resolve()
  }
  const facts = state.result?.current_facts && typeof state.result.current_facts === 'object' ? Object.entries(state.result.current_facts as Record<string, unknown>) : []
  const recalledItems = Array.isArray(state.result?.recalled_items)
    ? state.result.recalled_items as Array<Record<string, unknown>>
    : []
  return <IntelligencePanelShell title="Memory controls" description="View only the active user/thread facts. Durable consent is required for persistence; corrections and forget actions remain isolated." testId="intelligence-memory-panel" loading={state.loading} errorMessage={state.error} rateLimited={state.rateLimited} limitations={(state.result?.limitations as never) || []} evidence={(state.result?.evidence as never) || []} freshnessLabel="cross-thread and cross-user recall disabled">
    <div className="space-y-2 text-sm"><button type="button" onClick={() => void resolve()} disabled={!principalId || !threadId || state.loading} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">View thread facts</button><p className="text-xs text-slate-500">Source labels, expiry, correction, and forget controls apply only to this thread. No durable consent is granted here.</p>{facts.map(([key, value]) => <div key={key} className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">{key}: {String(value)} <span className="text-slate-500">(source: resolved fact; expiry: session)</span></div>)}{recalledItems.map((item) => <button type="button" key={String(item.memory_id)} onClick={() => void forget(String(item.memory_id))} className="block text-xs text-rose-600">Forget {String(item.fact_key || item.memory_id)}</button>)}<button type="button" onClick={() => { if (principalId && threadId) setItems((current) => [...current, buildMemoryCorrection({ principalId, threadId, memoryId: `correction-${Date.now()}`, factKey: 'correction', value: 'User correction pending resolution' })]) }} disabled={!principalId || !threadId} className="text-xs text-brand">Add session correction (not durable)</button></div>
  </IntelligencePanelShell>
}
