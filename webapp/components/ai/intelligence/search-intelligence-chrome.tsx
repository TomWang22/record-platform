'use client'

import { useCallback, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import {
  fetchSemanticSearchIntelligence,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import type { IntelligencePanelState } from '@/lib/ai-intelligence-types'

export type IntelligenceSearchMode = 'keyword' | 'semantic' | 'hybrid' | 'owner-scoped'

type SearchIntelligenceChromeProps = {
  query: string
  /** Keyword path remains the production listing browse default. */
  onKeywordSearch: () => void | Promise<void>
  keywordLoading?: boolean
  /** Owner-scoped collection search handler (records inventory). */
  onOwnerScopedSearch?: () => void | Promise<void>
}

type SemanticPayload = {
  mode?: string
  results?: Array<{ entity_id?: string; reason_codes?: string[]; score?: number }>
  retrieval_metrics?: { mode?: string; production_default?: string; fixture?: boolean }
  confidence?: number | { score?: number }
  limitations?: Array<{ code: string; message: string; severity?: string }>
  evidence?: Array<Record<string, unknown>>
  fallback_used?: boolean
  [key: string]: unknown
}

/**
 * Explicit search-mode chrome. Keyword is the production default.
 * Semantic/hybrid failures must never be presented as success after a silent
 * keyword fallback.
 */
export function SearchIntelligenceChrome({
  query,
  onKeywordSearch,
  keywordLoading,
  onOwnerScopedSearch,
}: SearchIntelligenceChromeProps) {
  const [selectedMode, setSelectedMode] = useState<IntelligenceSearchMode>('keyword')
  const [executedMode, setExecutedMode] = useState<IntelligenceSearchMode | null>(null)
  const [fallbackVisible, setFallbackVisible] = useState(false)
  const [state, setState] = useState<IntelligencePanelState<SemanticPayload>>({ status: 'idle' })

  const run = useCallback(async () => {
    setFallbackVisible(false)
    const q = query.trim()
    if (!q) {
      setState({ status: 'error', message: 'Enter a query before searching.' })
      return
    }

    if (selectedMode === 'keyword') {
      setExecutedMode('keyword')
      setState({ status: 'loading' })
      try {
        await onKeywordSearch()
        setState({
          status: 'ready',
          result: {
            mode: 'keyword',
            results: [],
            limitations: [
              {
                code: 'KEYWORD_PRODUCTION_DEFAULT',
                message: 'Keyword browse is the production default path.',
                severity: 'info',
              },
            ],
          },
        })
      } catch (err) {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Keyword search failed',
        })
      }
      return
    }

    if (selectedMode === 'owner-scoped') {
      setExecutedMode('owner-scoped')
      setState({ status: 'loading' })
      try {
        if (onOwnerScopedSearch) {
          await onOwnerScopedSearch()
        }
        setState({
          status: 'ready',
          result: {
            mode: 'owner-scoped',
            limitations: [
              {
                code: 'OWNER_SCOPED',
                message: 'Owner-scoped inventory search stays within authorized collection scope.',
                severity: 'info',
              },
            ],
          },
        })
      } catch (err) {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Owner-scoped search failed',
        })
      }
      return
    }

    // semantic | hybrid — never silently fall back to keyword on failure
    setState({ status: 'loading' })
    try {
      const response = await fetchSemanticSearchIntelligence({
        query: q,
        retrieval_mode: selectedMode,
        mode: selectedMode,
        production_mutation_allowed: false,
      })
      const result = (response.result || response) as SemanticPayload
      const actual = String(result.mode || result.retrieval_metrics?.mode || selectedMode)
      const normalized: IntelligenceSearchMode =
        actual.includes('hybrid') ? 'hybrid' : actual.includes('semantic') ? 'semantic' : 'keyword'

      // If API returned keyword while user selected semantic/hybrid, treat as visible fallback failure.
      if (normalized === 'keyword') {
        setFallbackVisible(true)
        setExecutedMode('keyword')
        setState({
          status: 'error',
          message:
            'Semantic/hybrid path returned keyword results. Silent fallback is forbidden — showing failure instead of success.',
        })
        return
      }

      setExecutedMode(normalized)
      setState({ status: 'ready', result })
    } catch (err) {
      setExecutedMode(null)
      if (err instanceof IntelligenceHttpError) {
        setState({
          status: 'error',
          httpStatus: err.httpStatus,
          message: err.message,
          rateLimited: err.rateLimited,
        })
        return
      }
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Semantic search failed',
      })
    }
  }, [onKeywordSearch, onOwnerScopedSearch, query, selectedMode])

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Search intelligence"
      description="Keyword is the production default. Semantic and hybrid are explicit modes — failures are never presented as keyword success."
      testId="intelligence-search-chrome"
      loading={state.status === 'loading' || Boolean(keywordLoading && selectedMode === 'keyword')}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      confidence={result?.confidence as number | { score?: number } | undefined}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={
        executedMode
          ? `selected=${selectedMode}; executed=${executedMode}; fallback_visible=${String(fallbackVisible)}`
          : `selected=${selectedMode}; executed=none`
      }
    >
      <div className="space-y-3 text-sm" data-testid="intelligence-search-controls">
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            Search mode
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Intelligence search mode">
            {(['keyword', 'semantic', 'hybrid', 'owner-scoped'] as const).map((mode) => (
              <label
                key={mode}
                className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${
                  selectedMode === mode
                    ? 'border-brand bg-brand/10 font-medium'
                    : 'border-slate-200 dark:border-white/10'
                }`}
              >
                <input
                  type="radio"
                  name="intelligence-search-mode"
                  value={mode}
                  checked={selectedMode === mode}
                  onChange={() => setSelectedMode(mode)}
                  className="sr-only"
                  data-testid={`intelligence-search-mode-${mode}`}
                />
                {mode}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={() => void run()}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white"
          data-testid="intelligence-search-run"
        >
          Run {selectedMode} search
        </button>
        {fallbackVisible ? (
          <p className="text-xs text-rose-600" data-testid="intelligence-search-fallback-visible">
            Fallback to keyword was detected and is shown as an error, not as semantic success.
          </p>
        ) : null}
        {state.status === 'ready' && result?.results && result.results.length > 0 ? (
          <ul className="space-y-1 text-xs" data-testid="intelligence-search-why">
            {result.results.map((row, idx) => (
              <li key={row.entity_id || idx}>
                {row.entity_id || `result-${idx}`}: {(row.reason_codes || []).join(', ') || 'matched'}
                {row.score != null ? ` (score ${row.score})` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
