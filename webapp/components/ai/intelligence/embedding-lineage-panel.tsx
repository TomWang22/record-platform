'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchEmbeddingMetadata, IntelligenceHttpError } from '@/lib/ai-intelligence-client'

export function EmbeddingLineagePanel({ principalId }: { principalId: string | null }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; rateLimited: boolean; result: Record<string, unknown> | null }>({ loading: false, error: null, rateLimited: false, result: null })
  async function run() {
    if (!principalId) return
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchEmbeddingMetadata({ principal_id: principalId, mode: 'lineage_validation', production_embedding_write_allowed: false })
      setState({ loading: false, error: null, rateLimited: false, result: (response.result || response) as Record<string, unknown> })
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : 'Embedding metadata request failed', rateLimited: error instanceof IntelligenceHttpError && error.rateLimited, result: null })
    }
  }
  const field = (key: string) => String(state.result?.[key] ?? '—')
  return <IntelligencePanelShell title="Embedding lineage (diagnostic)" description="Admin/development diagnostics only. This surface never creates or updates embeddings." testId="intelligence-embedding-lineage-panel" loading={state.loading} errorMessage={state.error} rateLimited={state.rateLimited} limitations={(state.result?.limitations as never) || []} evidence={(state.result?.evidence as never) || []} freshnessLabel={field('data_freshness')}>
    <div className="space-y-2 text-sm"><button type="button" onClick={() => void run()} disabled={!principalId || state.loading} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Inspect metadata</button>{state.result ? <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt>Model/version</dt><dd>{field('embedding_model_version')}</dd></div><div><dt>Dimension</dt><dd>{field('dimension')}</dd></div><div><dt>Content hash</dt><dd>{field('content_hash')}</dd></div><div><dt>Owner scope</dt><dd>{field('owner_scope')}</dd></div><div><dt>Deletion status</dt><dd>{field('deletion_propagation')}</dd></div><div><dt>Re-embed status</dt><dd>{field('reembedding_policy')}</dd></div></dl> : null}<p className="text-xs text-slate-500">Lineage: {state.result?.source_lineage ? JSON.stringify(state.result.source_lineage) : '—'} · production writes disabled.</p></div>
  </IntelligencePanelShell>
}
