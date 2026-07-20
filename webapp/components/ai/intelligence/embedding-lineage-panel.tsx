'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { fetchEmbeddingMetadata, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import { sanitizeCustomerFacingText } from '@/lib/ai-customer-copy'

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
  const human = (key: string) => {
    const raw = String(state.result?.[key] ?? '')
    const map: Record<string, string> = {
      CURRENT: 'Current',
      STALE: 'Stale',
      DELETED: 'Source deleted',
      REQUIRED: 'Re-embed required',
      NOT_REQUIRED: 'Not required',
      NOT_APPLICABLE: 'Not applicable',
      SOURCE_DELETED: 'Source deleted',
      not_required: 'Not required',
      verified: 'Verified',
      DISABLED: 'Disabled',
      ALLOWED: 'Allowed',
      BLOCKED_UNTIL_REEMBED: 'Blocked until re-embed',
      AUDIT_ONLY: 'Audit only',
      ACTIVE: 'Active',
    }
    return map[raw] || (raw ? sanitizeCustomerFacingText(raw) : '—')
  }
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
                <dt>Freshness</dt>
                <dd>{human('freshness')}</dd>
              </div>
              <div>
                <dt>Deletion status</dt>
                <dd>{human('deletion_propagation')}</dd>
              </div>
              <div>
                <dt>Re-embed required</dt>
                <dd>{String(state.result.reembed_required) === 'true' ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Re-embed status</dt>
                <dd>{human('reembed_status')}</dd>
              </div>
              {state.result.stale_reason ? (
                <div className="col-span-2">
                  <dt>Stale reason</dt>
                  <dd>{sanitizeCustomerFacingText(String(state.result.stale_reason))}</dd>
                </div>
              ) : null}
              {state.result.recommended_action ? (
                <div className="col-span-2">
                  <dt>Recommended action</dt>
                  <dd>{sanitizeCustomerFacingText(String(state.result.recommended_action))}</dd>
                </div>
              ) : null}
            </dl>
            <p className="text-xs text-slate-500">Production embedding writes remain disabled.</p>
          </>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
