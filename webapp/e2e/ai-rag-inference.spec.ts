import { execSync } from 'node:child_process'

import { test, expect } from '@playwright/test'

import type { AiEnvelope } from './helpers/ai-contract'
import {
  AUTH_EMAIL,
  obtainAuthToken,
  signInWithToken,
} from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  RAG_INFERENCE_PROMPTS,
  buildAggregate,
  extractSourceTypes,
  isOldBoilerplateOnly,
  leakageCheck,
  printUiInferenceConsoleSummary,
  responseExcerpt,
  scoreAnswer,
  writeUiInferenceArtifacts,
  type RagUiCaseResult,
  type RagUiSessionResult,
} from './helpers/ai-rag'

test.describe.configure({ timeout: 600_000, mode: 'serial' })

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

/** Fresh edge login — avoids stale `.contract-auth-cache.json` 401 in browser fetches. */
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

test.describe('AI RAG inference UI acceptance (T20.13P)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('UI walkthrough — seven prompts with rendered answers and network capture', async ({
    page,
    browser,
  }) => {
    const timestamp = runTimestamp()
    const baseURL = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
    const cases: RagUiCaseResult[] = []

    await signInFreshContract(page)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('ai-rag-question-input')).toBeVisible()
    await expect(page.getByTestId('ai-insight-rag-ready')).toBeVisible({ timeout: 120_000 })

    const ragPanel = page.getByTestId('ai-insight-rag')

    for (const { id, prompt } of RAG_INFERENCE_PROMPTS) {
      const submitTs = Date.now()

      await page.getByTestId('ai-rag-question-input').fill(prompt)

      const responsePromise = page.waitForResponse(
        (res) => {
          if (!res.url().includes('/api/ai/rag/query') || res.request().method() !== 'POST') {
            return false
          }
          try {
            const data = res.request().postDataJSON() as { question?: string }
            return data?.question === prompt
          } catch {
            return false
          }
        },
        { timeout: 120_000 },
      )

      await ragPanel.getByRole('button', { name: 'Query' }).click()

      const response = await responsePromise
      const httpStatus = response.status()
      let envelope: AiEnvelope | null = null
      let errorMessage: string | null = null

      try {
        envelope = (await response.json()) as AiEnvelope
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      await expect(ragPanel.getByText('Loading RAG insight…')).toHaveCount(0, { timeout: 120_000 })
      const summary = page.getByTestId('ai-rag-summary')
      if (envelope?.summary) {
        const uiAnchor = envelope.summary.slice(0, 48).trim()
        await expect(summary).toContainText(uiAnchor, { timeout: 120_000 })
      } else {
        await expect(summary).toBeVisible({ timeout: 30_000 })
      }

      const answerVisibleTs = Date.now()
      const answerText = (await summary.innerText()).trim()
      const sourceItems = ragPanel.getByTestId('ai-source-ref-item')
      const sourceCount = await sourceItems.count()
      const visibleSourceParts: string[] = []
      for (let i = 0; i < Math.min(sourceCount, 3); i++) {
        visibleSourceParts.push((await sourceItems.nth(i).innerText()).trim())
      }

      const sourceTypes = envelope ? extractSourceTypes(envelope) : []
      const refsCount = envelope?.source_refs?.length ?? 0
      const retrievalMode = String(envelope?.details?.retrieval_mode ?? 'unknown')
      const modelUsed = envelope?.model_used ?? 'unknown'
      const synthesisTemplate =
        typeof envelope?.details?.synthesis === 'object' &&
        envelope?.details?.synthesis !== null &&
        'template' in (envelope.details.synthesis as object)
          ? String((envelope.details.synthesis as { template?: string }).template ?? '')
          : null

      const timing = response.request().timing()
      const networkMs =
        timing.responseEnd > 0 && timing.requestStart > 0
          ? Math.round(timing.responseEnd - timing.requestStart)
          : answerVisibleTs - submitTs

      const backendTiming =
        typeof envelope?.details?.timing_ms === 'number'
          ? envelope.details.timing_ms
          : typeof envelope?.details?.latency_ms === 'number'
            ? envelope.details.latency_ms
            : null

      const combinedText = `${answerText}\n${JSON.stringify(envelope ?? {})}`
      const leakage = leakageCheck(combinedText, sourceTypes)
      const { score, useful } = scoreAnswer(id, answerText)
      const oldBoilerplate = isOldBoilerplateOnly(answerText)

      cases.push({
        case_id: id,
        prompt,
        ui_url: `${baseURL}/insights`,
        login_user: AUTH_EMAIL,
        submit_timestamp: new Date(submitTs).toISOString(),
        answer_visible_timestamp: new Date(answerVisibleTs).toISOString(),
        ui_total_ms: answerVisibleTs - submitTs,
        network_request_ms: networkMs,
        backend_timing_ms: backendTiming,
        http_status: httpStatus,
        retrieval_mode: retrievalMode,
        model_used: modelUsed,
        answer_text: answerText,
        answer_visible: answerText.length > 0,
        answer_char_count: answerText.length,
        answer_excerpt_800_chars: answerText.slice(0, 800),
        source_types: sourceTypes,
        refs_count: refsCount,
        visible_source_excerpt: visibleSourceParts.join(' | '),
        response_source_excerpt: envelope ? responseExcerpt(envelope) : '',
        synthesis_template: synthesisTemplate,
        leakage_result: leakage,
        error_message: errorMessage,
        quality_score: score,
        useful,
        old_boilerplate_only: oldBoilerplate,
      })

      expect(httpStatus, `${id} HTTP`).toBe(200)
      expect(envelope, `${id} envelope`).toBeTruthy()
      expect(retrievalMode, `${id} retrieval_mode`).toBe('keyword')
      expect(modelUsed, `${id} model_used`).toBe('rule-engine')
      expect(answerText.length, `${id} answer length`).toBeGreaterThan(80)
      expect(oldBoilerplate, `${id} boilerplate regression`).toBe(false)
      expect(refsCount, `${id} refs`).toBeGreaterThan(0)
      expect(leakage, `${id} leakage`).toBe('PASS')
      expect(answerText, `${id} synthesis visible`).toMatch(
        /Grounding:|Recommended next step|Offer|catalog|seller|Negotiation|marketplace|revision|attention/i,
      )
    }

    const session: RagUiSessionResult = {
      ticket: 'T20.13P',
      baseline_sha: baselineSha(),
      run_timestamp: timestamp,
      base_url: baseURL,
      browser: browser.browserType().name(),
      viewport,
      login_user: AUTH_EMAIL,
      command:
        './scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-inference.spec.ts --grep "AI RAG inference UI acceptance"',
      cases,
      aggregate: buildAggregate(cases),
    }

    const paths = writeUiInferenceArtifacts(session, timestamp)
    printUiInferenceConsoleSummary(session, paths)

    expect(session.aggregate.ui_pass).toBe(session.aggregate.cases)
    expect(session.aggregate.keyword_rule_engine).toBe(session.aggregate.cases)
    expect(session.aggregate.leakage).toBe('PASS')
    expect(session.aggregate.old_boilerplate_regression).toBe(false)

    const avgScore =
      cases.reduce((sum, c) => sum + c.quality_score, 0) / Math.max(cases.length, 1)
    expect(avgScore).toBeGreaterThanOrEqual(3.5)
  })
})
