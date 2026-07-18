'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { fetchEmbeddingMetadata, IntelligenceHttpError } from '@/lib/ai-intelligence-client'

const DEFAULT_INTENT = "Show lineage for this record's current embedding."

export function EmbeddingLineagePanel({ principalId }: { principalId: string | null }) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    rateLimited: boolean
    result: Record<string, unknown> | null
  }>({ loading: false, error: null, rateLimited: false, result: null })
  const [lastIntent, setLastIntent] = useState(DEFAULT_INTENT)

  async function run(intent: string) {
    if (!principalId) return
    setLastIntent(intent)
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchEmbeddingMetadata({
        principal_id: principalId,
        mode: 'lineage_validation',
        production_embedding_write_allowed: false,
        user_intent: intent,
        owner_proof_prompt: intent,
      })
      setState({
        loading: false,
        error: null,
        rateLimited: false,
        result: (response.result || response) as Record<string, unknown>,
      })
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Embedding metadata request failed',
        rateLimited: error instanceof IntelligenceHttpError && error.rateLimited,
        result: null,
      })
    }
  }

  const field = (key: string) => String(state.result?.[key] ?? '—')
  return (
    <IntelligencePanelShell
      title="Embedding lineage (diagnostic)"
      description="Admin/development diagnostics only. This surface never creates or updates embeddings."
      testId="intelligence-embedding-lineage-panel"
      capability="embeddings"
      loading={state.loading}
      errorMessage={state.error}
      rateLimited={state.rateLimited}
      limitations={(state.result?.limitations as never) || []}
      evidence={(state.result?.evidence as never) || []}
      freshnessLabel={field('data_freshness')}
    >
      <div className="space-y-2 text-sm">
        <OwnerProofIntentControl
          capability="embeddings"
          defaultIntent={DEFAULT_INTENT}
          runLabel="Inspect metadata"
          runTestId="intelligence-embedding-lineage-run"
          disabled={!principalId || state.loading}
          onRun={run}
        />
        {state.result ? (
          <>
            <p className="text-xs text-slate-500">Answering: {lastIntent}</p>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt>Model/version</dt>
                <dd>{field('embedding_model_version')}</dd>
              </div>
              <div>
                <dt>Dimension</dt>
                <dd>{field('dimension')}</dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd className="break-all">{field('content_hash')}</dd>
              </div>
              <div>
                <dt>Owner scope</dt>
                <dd>{field('owner_scope')}</dd>
              </div>
              <div>
                <dt>Deletion status</dt>
                <dd>{field('deletion_propagation')}</dd>
              </div>
              <div>
                <dt>Re-embed status</dt>
                <dd>{field('reembedding_policy')}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">Production embedding writes remain disabled.</p>
          </>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
