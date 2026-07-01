import { execSync } from 'node:child_process'

import { test, expect } from '@playwright/test'

import type { AiEnvelope } from './helpers/ai-contract'
import { AUTH_EMAIL, obtainAuthToken, signInWithToken } from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import { extractSourceTypes, isOldBoilerplateOnly, leakageCheck } from './helpers/ai-rag'
import {
  LONGFORM_TURNS,
  buildLongformAggregate,
  buildTurnPrompt,
  evaluateLongformTurn,
  extractApiExcerpts,
  extractShadowTelemetry,
  printLongformConsoleSummary,
  ragQueryMatchesTurn,
  writeLongformArtifacts,
  type LongformSessionResult,
  type LongformTurnResult,
} from './helpers/ai-rag-longform-record-session'

test.describe.configure({ timeout: 900_000, mode: 'serial' })

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

test.describe('AI longform record collector RAG session (T20.13V)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('UI walkthrough — twelve-turn gauntlet with accumulated context', async ({ page, browser }) => {
    const timestamp = runTimestamp()
    const baseURL = (process.env.E2E_API_BASE ?? 'https://record-platform.test').replace(/\/$/, '')
    const turns: LongformTurnResult[] = []

    await signInFreshContract(page)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('ai-rag-question-input')).toBeVisible()
    await expect(page.getByTestId('ai-insight-rag-ready')).toBeVisible({ timeout: 120_000 })

    const ragPanel = page.getByTestId('ai-insight-rag')

    for (let i = 0; i < LONGFORM_TURNS.length; i++) {
      const turnIndex = i + 1
      const { id, theme } = LONGFORM_TURNS[i]
      const { prompt, accumulated_context_chars } = buildTurnPrompt(turnIndex, turns)
      const prompt_chars = prompt.length
      const estimated_prompt_tokens = Math.ceil(prompt_chars / 4)
      const submitTs = Date.now()
      let timedOut = false
      let errorMessage: string | null = null

      await page.getByTestId('ai-rag-question-input').fill(prompt)

      const responseTimeout = prompt_chars > 2000 ? 180_000 : 120_000
      const responsePromise = page.waitForResponse(
        (res) => {
          if (!res.url().includes('/api/ai/rag/query') || res.request().method() !== 'POST') {
            return false
          }
          try {
            const data = res.request().postDataJSON() as { question?: string }
            return ragQueryMatchesTurn(id, data?.question ?? '', prompt)
          } catch {
            return false
          }
        },
        { timeout: responseTimeout },
      )

      await ragPanel.getByRole('button', { name: 'Query' }).click()

      let response: import('@playwright/test').Response
      try {
        response = await responsePromise
      } catch (err) {
        timedOut = true
        errorMessage = err instanceof Error ? err.message : String(err)
        turns.push({
          turn_id: id,
          turn_index: turnIndex,
          theme,
          prompt,
          prompt_chars,
          estimated_prompt_tokens,
          accumulated_context_chars,
          ui_total_ms: Date.now() - submitTs,
          api_ms: 0,
          http_status: 0,
          retrieval_mode: 'unknown',
          model_used: 'unknown',
          synthesis_template: null,
          answer_text: '',
          answer_chars: 0,
          answer_excerpt_1000: '',
          source_types: [],
          refs_count: 0,
          visible_source_refs_count: 0,
          api_source_excerpt_1: '',
          api_source_excerpt_2: '',
          leakage_result: 'FAIL_timeout',
          old_boilerplate_present: false,
          timeout: true,
          error_message: errorMessage,
          shadow_selected_count: null,
          shadow_source_types: [],
          evaluation: evaluateLongformTurn(id, turnIndex, prompt, '', [], accumulated_context_chars),
        })
        expect.soft(false, `${id} timeout`).toBe(true)
        continue
      }

      const httpStatus = response.status()
      let envelope: AiEnvelope | null = null
      try {
        envelope = (await response.json()) as AiEnvelope
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      await expect(ragPanel.getByText('Loading RAG insight…')).toHaveCount(0, { timeout: 120_000 })

      let answerText = ''
      const summary = page.getByTestId('ai-rag-summary')
      if (id === 'executive_summary') {
        await expect(summary).toContainText('[grounded]', { timeout: 120_000 })
        await expect(summary).toContainText('[missing evidence]', { timeout: 120_000 })
        await expect(summary).toContainText('[needs manual review]', { timeout: 120_000 })
        answerText = (await summary.innerText()).trim()
        expect(envelope?.summary ?? '').toMatch(/\[grounded\]/i)
        expect(envelope?.summary ?? '').toMatch(/\[missing evidence\]/i)
        expect(envelope?.summary ?? '').toMatch(/\[needs manual review\]/i)
      } else if (envelope?.summary) {
        const marker =
          envelope.summary
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 12)?.slice(0, 48) ?? envelope.summary.slice(0, 40).trim()
        await expect(summary).toContainText(marker, { timeout: 120_000 })
        answerText = (await summary.innerText()).trim()
      } else {
        const errorEl = ragPanel.locator('p.text-rose-600')
        if (await errorEl.count()) answerText = (await errorEl.innerText()).trim()
      }

      const answerVisibleTs = Date.now()
      const sourceItems = ragPanel.getByTestId('ai-source-ref-item')
      const visibleSourceRefsCount = await sourceItems.count()

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

      const excerpts = envelope ? extractApiExcerpts(envelope) : []
      const shadow = envelope ? extractShadowTelemetry(envelope) : { shadow_selected_count: null, shadow_source_types: [] }
      const combinedText = `${answerText}\n${JSON.stringify(envelope ?? {})}`
      const leakage = leakageCheck(combinedText, sourceTypes)
      const oldBoilerplate = isOldBoilerplateOnly(answerText)
      const evaluation = evaluateLongformTurn(id, turnIndex, prompt, answerText, sourceTypes, accumulated_context_chars)

      turns.push({
        turn_id: id,
        turn_index: turnIndex,
        theme,
        prompt,
        prompt_chars,
        estimated_prompt_tokens,
        accumulated_context_chars,
        ui_total_ms: answerVisibleTs - submitTs,
        api_ms: networkMs,
        http_status: httpStatus,
        retrieval_mode: retrievalMode,
        model_used: modelUsed,
        synthesis_template: synthesisTemplate,
        answer_text: answerText,
        answer_chars: answerText.length,
        answer_excerpt_1000: answerText.slice(0, 1000),
        source_types: sourceTypes,
        refs_count: refsCount,
        visible_source_refs_count: visibleSourceRefsCount,
        api_source_excerpt_1: excerpts[0] ?? '',
        api_source_excerpt_2: excerpts[1] ?? '',
        leakage_result: leakage,
        old_boilerplate_present: oldBoilerplate,
        timeout: timedOut,
        error_message: errorMessage,
        shadow_selected_count: shadow.shadow_selected_count,
        shadow_source_types: shadow.shadow_source_types,
        evaluation,
      })

      expect.soft(httpStatus, `${id} HTTP`).toBeLessThan(500)
      expect.soft(httpStatus, `${id} HTTP 200`).toBe(200)
      expect.soft(envelope, `${id} envelope`).toBeTruthy()
      expect.soft(answerText.length, `${id} answer length`).toBeGreaterThan(80)
      expect.soft(oldBoilerplate, `${id} boilerplate`).toBe(false)
      expect.soft(retrievalMode, `${id} retrieval_mode`).toMatch(
        /^(keyword|hybrid_canary|keyword_fallback_from_hybrid)$/,
      )
      expect.soft(modelUsed, `${id} model_used`).toBe('rule-engine')
      expect.soft(leakage, `${id} leakage`).toBe('PASS')
      expect.soft(evaluation.safety, `${id} safety`).toBe('pass')
    }

    const session: LongformSessionResult = {
      ticket: 'T20.13V',
      mode: 'ui',
      baseline_sha: baselineSha(),
      run_timestamp: timestamp,
      base_url: baseURL,
      browser: browser.browserType().name(),
      login_user: AUTH_EMAIL,
      command:
        './scripts/webapp-playwright-strict-edge.sh e2e/ai-rag-longform-record-session.spec.ts --grep "AI longform record collector RAG session"',
      runtime_config: {
        ai_model_provider: 'rule',
        rag_max_context_tokens: 2048,
        rag_max_chunks: 8,
        max_response_tokens: 512,
        generative_ollama_for_rag: false,
      },
      turns,
      aggregate: buildLongformAggregate(turns),
    }

    const paths = writeLongformArtifacts(session, timestamp)
    printLongformConsoleSummary(session, paths)

    expect(session.aggregate.turns).toBe(12)
    expect(session.aggregate.turns_pass).toBe(12)
    expect(session.aggregate.http_500_count).toBe(0)
    expect(session.aggregate.leakage).toBe('PASS')
    expect(session.aggregate.old_boilerplate_regression).toBe(false)
    expect(session.turns[11].answer_text).toMatch(/\[grounded\]/i)
    expect(session.turns[11].answer_text).toMatch(/\[missing evidence\]/i)
    expect(session.turns[11].answer_text).toMatch(/\[needs manual review\]/i)
    expect(session.aggregate.avg_score).toBeGreaterThanOrEqual(3.5)
  })
})
