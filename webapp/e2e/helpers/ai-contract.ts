import { expect } from '@playwright/test'

export type AiSourceRef = {
  source_type: string
  source_id: string
  field?: string
  freshness?: string
  checksum?: string
}

export type AiEnvelope = {
  insight_id: string
  contract_id: string
  source_status: 'live' | 'degraded'
  model_used: string
  generated_at?: string
  confidence?: number
  summary: string
  details?: Record<string, unknown>
  source_refs: AiSourceRef[]
  citations?: unknown[]
  degraded_reason?: string
}

const FORBIDDEN = /demo|mock|sample fallback|placeholder|lorem ipsum/i

export function assertAiEnvelope(body: AiEnvelope, opts?: { requireLive?: boolean }) {
  expect(body.insight_id, 'insight_id').toBeTruthy()
  expect(body.contract_id, 'contract_id').toBeTruthy()
  expect(['live', 'degraded']).toContain(body.source_status)
  expect(body.model_used, 'model_used').toBeTruthy()
  expect(body.summary, 'summary').toBeTruthy()
  expect(body.summary).not.toMatch(FORBIDDEN)
  expect(JSON.stringify(body)).not.toMatch(FORBIDDEN)
  expect(body.source_refs?.length ?? 0, 'source_refs non-empty').toBeGreaterThan(0)
  for (const ref of body.source_refs) {
    expect(ref.source_type).toBeTruthy()
    expect(ref.source_id).toBeTruthy()
  }
  if (opts?.requireLive) {
    expect(body.source_status).toBe('live')
  }
}

export function assertDegradedStatus(body: {
  source_status?: string
  providers?: Record<string, { available?: boolean }>
  degraded_reason?: string
}) {
  expect(body.source_status).toBe('degraded')
  const blob = JSON.stringify(body)
  expect(blob).not.toMatch(FORBIDDEN)
}
