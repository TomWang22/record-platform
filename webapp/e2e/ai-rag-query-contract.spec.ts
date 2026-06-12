import { test, expect } from '@playwright/test'

import { assertAiEnvelope, assertDegradedStatus, type AiEnvelope } from './helpers/ai-contract'
import { obtainAuthToken } from './helpers/auth'
import { postJsonWith429Retry, getJsonWith429Retry } from './helpers/http-retry'

test.describe.configure({ timeout: 180_000 })

test.describe('AI RAG query contract', () => {
  test('live path — grounded query with source_refs', async ({ request }) => {
    const token = await obtainAuthToken(request)
    const status = await getJsonWith429Retry<{
      source_status: string
      corpus?: { document_count?: number }
    }>(request, '/api/ai/rag/status', { Authorization: `Bearer ${token}` }, 'rag status')

    expect((status.corpus?.document_count ?? 0) > 0).toBeTruthy()

    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/rag/query',
      { Authorization: `Bearer ${token}` },
      { question: 'listing price condition shipping' },
      'rag query',
    )
    assertAiEnvelope(body)
    expect(body.contract_id).toBe('rag_query')
    expect(body.details?.retrieval_mode).toBe('keyword')
  })

  test('degraded status when corpus/provider unavailable is structured', async ({ request }) => {
    const token = await obtainAuthToken(request)
    const status = await getJsonWith429Retry<Record<string, unknown>>(
      request,
      '/api/ai/rag/status',
      { Authorization: `Bearer ${token}` },
      'rag status degraded probe',
    )
    if (status.source_status === 'live') {
      test.skip(true, 'cluster live — degraded path covered by audit when Ollama down')
    }
    assertDegradedStatus(status as { source_status?: string })
  })
})
