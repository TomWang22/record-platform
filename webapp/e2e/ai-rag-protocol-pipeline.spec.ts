import { execSync } from 'node:child_process'

import { test, expect } from '@playwright/test'

import type { AiEnvelope } from './helpers/ai-contract'
import { AUTH_EMAIL, signInWithToken } from './helpers/auth'
import { extractSourceTypes, leakageCheck } from './helpers/ai-rag'
import {
  pickResource,
  writeProtocolArtifacts,
  type ProtocolPipelineSession,
  type ProtocolResourceEntry,
} from './helpers/ai-rag-protocol-pipeline'

test.describe.configure({ timeout: 300_000, mode: 'serial' })

function baselineSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function runTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

async function signInFreshContract(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.post('/api/auth/login', {
    data: { email: AUTH_EMAIL, password: 'ContractPass123!' },
    headers: { 'X-RP-E2E-Contract': '1' },
  })
  expect(res.ok(), `fresh login: ${await res.text()}`).toBeTruthy()
  const { token } = (await res.json()) as { token: string }
  await signInWithToken(page, token, AUTH_EMAIL)
  return token
}

test.describe('AI RAG protocol pipeline acceptance (T20.13U)', () => {
  test('Browser protocol telemetry — insights document and RAG query', async ({ page, browser }) => {
    const timestamp = runTimestamp()
    const baseURL = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
    const consoleErrors: string[] = []
    const failedRequests: Array<{ url: string; status: number; method: string }> = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() >= 400) {
        failedRequests.push({ url: res.url(), status: res.status(), method: res.request().method() })
      }
    })

    await signInFreshContract(page)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })

    const docEntries = await page.evaluate(() => {
      const perf = window.performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return perf.map((e) => ({
        name: e.name,
        initiatorType: e.initiatorType,
        nextHopProtocol: e.nextHopProtocol || 'not_exposed',
        duration_ms: Math.round(e.duration),
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        responseStatus: (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus,
      }))
    })

    const documentProtocol = pickResource(docEntries as ProtocolResourceEntry[], (e) =>
      e.name.includes('/insights'),
    )

    const ragPrompt =
      'What auction or bidding signals should I watch right now? Look for bid activity, urgency, risk, and whether I should adjust listing strategy. If there is not enough auction evidence, say so.'
    const ragPanel = page.getByTestId('ai-insight-rag')
    const submitTs = Date.now()

    await page.getByTestId('ai-rag-question-input').fill(ragPrompt)
    const responsePromise = page.waitForResponse(
      (res) => {
        if (!res.url().includes('/api/ai/rag/query') || res.request().method() !== 'POST') return false
        try {
          return (res.request().postDataJSON() as { question?: string }).question === ragPrompt
        } catch {
          return false
        }
      },
      { timeout: 120_000 },
    )
    await ragPanel.getByRole('button', { name: 'Query' }).click()
    const response = await responsePromise
    const httpStatus = response.status()
    const envelope = (await response.json()) as AiEnvelope
    await expect(ragPanel.getByText('Loading RAG insight…')).toHaveCount(0, { timeout: 120_000 })
    await expect(page.getByTestId('ai-rag-summary')).toContainText(envelope.summary.slice(0, 40), {
      timeout: 120_000,
    })
    const answerVisibleTs = Date.now()

    const allEntries = await page.evaluate(() => {
      const perf = window.performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return perf.map((e) => ({
        name: e.name,
        initiatorType: e.initiatorType,
        nextHopProtocol: e.nextHopProtocol || 'not_exposed',
        duration_ms: Math.round(e.duration),
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        responseStatus: (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus,
      }))
    })

    const ragProtocol = pickResource(allEntries as ProtocolResourceEntry[], (e) =>
      e.name.includes('/api/ai/rag/query'),
    )

    const timing = response.request().timing()
    const networkMs =
      timing.responseEnd > 0 && timing.requestStart > 0
        ? Math.round(timing.responseEnd - timing.requestStart)
        : answerVisibleTs - submitTs

    const sourceTypes = extractSourceTypes(envelope)
    const leakage = leakageCheck(`${envelope.summary}\n${JSON.stringify(envelope)}`, sourceTypes)
    const retrievalMode = String(envelope.details?.retrieval_mode ?? 'unknown')
    const modelUsed = envelope.model_used ?? 'unknown'

    const session: ProtocolPipelineSession = {
      ticket: 'T20.13U',
      baseline_sha: baselineSha(),
      run_timestamp: timestamp,
      base_url: baseURL,
      browser: browser.browserType().name(),
      document_protocol: documentProtocol,
      rag_query_protocol: ragProtocol,
      rag_http_status: httpStatus,
      rag_ui_ms: answerVisibleTs - submitTs,
      rag_api_ms: networkMs,
      console_errors: consoleErrors,
      failed_requests: failedRequests.filter((r) => r.url.includes('/api/ai')),
      retrieval_mode: retrievalMode,
      model_used: modelUsed,
      leakage,
    }

    const paths = writeProtocolArtifacts(session, timestamp)
    console.log('\nProtocol pipeline browser capture complete\n')
    console.log(`JSON: ${paths.jsonPath}`)
    console.log(`Document protocol: ${documentProtocol?.nextHopProtocol ?? 'not_exposed'}`)
    console.log(`RAG protocol: ${ragProtocol?.nextHopProtocol ?? 'not_exposed'}`)
    console.log(`RAG HTTP: ${httpStatus}`)

    expect(httpStatus).toBe(200)
    expect(retrievalMode).toBe('keyword')
    expect(modelUsed).toBe('rule-engine')
    expect(leakage).toBe('PASS')
    expect(envelope.summary.length).toBeGreaterThan(120)
    expect(failedRequests.filter((r) => r.url.includes('/api/ai/rag/query'))).toHaveLength(0)
  })
})
