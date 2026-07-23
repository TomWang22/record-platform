#!/usr/bin/env node
/**
 * Stage D — real-model full evaluation: 20,000 unique logical sessions.
 * All model-eligible turns must invoke the model. H1/H2/H3 share one inference.
 * Do not launch unless Stages A/B/C froze PASS.
 * Evidence: /tmp/phase34-real-model-full-eval-v1
 */
import fs from 'node:fs';
import { finished } from 'node:stream/promises';
import crypto from 'node:crypto';
import { EIGHT_CAPABILITIES } from '../lib/phase34-capability-response.mjs';
import { synthesizeDeterministic, synthesizeGrounded } from '../lib/phase34-grounded-synthesis.mjs';
import { createOllamaModelGateway } from '../lib/phase34-ollama-model-gateway.mjs';
import { guardWithRetry } from '../lib/phase34-invention-guard.mjs';
import { retrieve, createRetrievalStores } from '../lib/phase34-retrieval.mjs';
import { createPersistedEmbeddingStore } from '../lib/phase34-persisted-vector-index.mjs';
import {
  decideModelEligibility,
  emptyEligibilityCounters,
  recordEligibilityOutcome,
  assertEligibilityCoverage,
  FALLBACK_CLASS,
} from '../lib/phase34-model-eligibility.mjs';
import {
  createInferenceIds,
  canonicalRequestHash,
  putCanonicalInference,
  verifyProtocolTriplet,
  clearCanonicalInferenceStore,
} from '../lib/phase34-canonical-inference.mjs';
import {
  createConversationSession,
  appendConversationTurn,
  applyCorrection,
  activeFactsMap,
  createDraft,
} from '../lib/phase34-conversation-memory.mjs';

const EVID = process.env.PHASE34_EVIDENCE_ROOT || '/tmp/phase34-real-model-full-eval-v1';
const TOTAL = Number(process.env.PHASE34_FULL_EVAL_SESSIONS || 20000);
const PER_CAP = TOTAL / EIGHT_CAPABILITIES.length; // 2500
const MULTI_FRAC = Number(process.env.PHASE34_MULTI_FRAC || 0.27);

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** Balanced success / correction / honest-limit / adversarial within each capability. */
function classFor(j) {
  if (j < 1000) return 'success';
  if (j < 1800) return 'correction';
  if (j < 2150) return 'honest_limit';
  return 'adversarial';
}

function nearestRankPercentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (p <= 0) return sortedAsc[0];
  if (p >= 100) return sortedAsc[n - 1];
  const rank = Math.ceil((p / 100) * n);
  return sortedAsc[Math.min(n - 1, Math.max(0, rank - 1))];
}

function latencyReport(samplesMs) {
  const missing = samplesMs.filter((x) => x == null || Number.isNaN(x)).length;
  const vals = samplesMs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  const n = vals.length;
  const coverage = samplesMs.length === 0 ? 0 : n / samplesMs.length;
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null;
  const p = (pct) => {
    if (n === 0) return { value: null, label: 'NOT_ESTIMABLE' };
    const expectedTail = n * (1 - pct / 100);
    let label = 'SUPPORTED';
    if (expectedTail < 1) label = 'NOT_ESTIMABLE';
    else if (expectedTail < 10) label = 'LOW_SAMPLE_ESTIMATE';
    if (label === 'NOT_ESTIMABLE' && pct < 100) {
      return { value: null, label };
    }
    if (pct === 100) {
      return { value: vals[n - 1], label: 'OBSERVED_MAX_ONLY' };
    }
    return { value: nearestRankPercentile(vals, pct), label };
  };
  return {
    sample_count: n,
    missing_count: missing,
    coverage_ratio: coverage,
    minimum: n ? vals[0] : null,
    median: n ? nearestRankPercentile(vals, 50) : null,
    arithmetic_mean: mean,
    maximum: n ? vals[n - 1] : null,
    p50: p(50),
    p90: p(90),
    p95: p(95),
    p99: p(99),
    p99_9: p(99.9),
    p99_99: p(99.99),
    p99_999: p(99.999),
    p99_9999: p(99.9999),
    p100: p(100),
  };
}

function structuredFor(capability, klass, values = {}) {
  if (klass === 'honest_limit') {
    return {
      sold_count: 0,
      sample_size: 0,
      currency: 'USD',
      conclusion: 'Insufficient eligible evidence.',
      limitations: ['INSUFFICIENT_EVIDENCE'],
      confidence: 'low',
      automatic_send_allowed: false,
      message_sent: false,
      draft: '',
    };
  }
  const median = Number(values.median ?? 42);
  const sold = Number(values.sold_count ?? 3);
  const floor = Number(values.seller_floor_usd ?? 40);
  const base = {
    sold_count: sold,
    median,
    currency: 'USD',
    fair_low: median - 7,
    fair_high: median + 8,
    seller_floor: floor,
    automatic_send_allowed: false,
    message_sent: false,
    draft: `Would you consider ${floor} USD?`,
    confidence: 'medium',
    conclusion: `Completed-sale median is ${median} USD across ${sold} sales.`,
  };
  if (capability === 'scarcity') return { ...base, scarcity_label: 'moderate', exact_pressing: true };
  if (capability === 'auction_intelligence') return { ...base, watchers: 12, bid_count: 4 };
  if (capability === 'recommendations') return { ...base, candidate_count: 5, budget_max: 60 };
  if (capability === 'market_analytics') return { ...base, population: sold, time_window_days: 90 };
  return base;
}

function expectedEligiblePreview() {
  let eligible = 0;
  let turns = 0;
  let multi = 0;
  for (const capability of EIGHT_CAPABILITIES) {
    for (let j = 0; j < PER_CAP; j += 1) {
      const klass = classFor(j);
      const isMulti = j / PER_CAP < MULTI_FRAC && klass !== 'adversarial';
      const depth = isMulti ? 4 + (j % 9) : 1;
      if (isMulti) multi += 1;
      for (let t = 0; t < depth; t += 1) {
        turns += 1;
        if (decideModelEligibility({ capability, scenario_class: klass }).eligible) eligible += 1;
      }
    }
  }
  return { sessions: TOTAL, multi_turn_sessions: multi, total_turns: turns, model_eligible_turns: eligible };
}

async function main() {
  if (fs.existsSync(`${EVID}/real-model-full-eval.json`)) {
    console.error(JSON.stringify({ ok: false, reason: 'EVIDENCE_ROOT_ALREADY_FINALIZED', evid: EVID }));
    process.exit(3);
  }
  if (fs.existsSync(`${EVID}/FROZEN_BLOCKED_EVIDENCE`) || fs.existsSync(`${EVID}/FROZEN_PASS_EVIDENCE`)) {
    console.error(JSON.stringify({ ok: false, reason: 'EVIDENCE_ROOT_FROZEN', evid: EVID }));
    process.exit(3);
  }

  clearCanonicalInferenceStore();
  fs.mkdirSync(`${EVID}/ledgers`, { recursive: true });

  const preview = expectedEligiblePreview();
  process.stdout.write(`model_eligible_turns_denominator_preview=${preview.model_eligible_turns}\n`);
  process.stdout.write(`sessions=${preview.sessions} multi=${preview.multi_turn_sessions} turns=${preview.total_turns}\n`);
  fs.writeFileSync(`${EVID}/eligibility-denominator-preview.json`, JSON.stringify(preview, null, 2) + '\n');

  const docs = [
    {
      id: 'doc-a',
      market_event_id: 'me-a',
      artist: 'Miles Davis',
      title: 'Kind of Blue',
      summary: 'completed sale vinyl',
      tags: ['vinyl', 'jazz'],
      sale_kind: 'sold',
      event_type: 'SALE_COMPLETED',
      price: 42,
    },
    {
      id: 'doc-b',
      market_event_id: 'me-b',
      artist: 'John Coltrane',
      title: 'Blue Train',
      summary: 'classic lp edition',
      tags: ['lp', 'jazz'],
      sale_kind: 'sold',
      event_type: 'SALE_COMPLETED',
      price: 38,
    },
  ];
  const store = createPersistedEmbeddingStore(`${EVID}/persisted-embeddings.jsonl`);
  store.upsertDocs(docs);
  const stores = createRetrievalStores({ catalog: docs });
  const gateway = createOllamaModelGateway({
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11436',
    timeoutMs: Number(process.env.PHASE34_OLLAMA_TIMEOUT_MS || 180000),
  });
  const health = await gateway.health();
  if (!health.ok) {
    console.error(JSON.stringify({ ok: false, health }));
    process.exit(2);
  }

  const counters = emptyEligibilityCounters();
  const hard_failures = [];
  const generationLatencies = [];
  let multi_turn_sessions = 0;
  const sessionStream = fs.createWriteStream(`${EVID}/ledgers/sessions.jsonl`, { flags: 'a' });
  const modelStream = fs.createWriteStream(`${EVID}/ledgers/model-invocations.jsonl`, { flags: 'a' });
  let sessionIndex = 0;
  let stopNew = false;

  for (const capability of EIGHT_CAPABILITIES) {
    if (stopNew) break;
    for (let j = 0; j < PER_CAP; j += 1) {
      if (stopNew) break;
      const klass = classFor(j);
      const isMulti = j / PER_CAP < MULTI_FRAC && klass !== 'adversarial';
      const depth = isMulti ? 4 + (j % 9) : 1; // 4–12
      if (isMulti) multi_turn_sessions += 1;

      const session_id = `rmf-${String(sessionIndex).padStart(5, '0')}`;
      sessionIndex += 1;
      const owner = `owner-${sessionIndex % 31}`;
      const sessionDoc = createConversationSession({
        session_id,
        principal_id: owner,
        thread_id: `thread-${sessionIndex % 41}`,
      });
      applyCorrection(sessionDoc, {
        key: 'sold_count',
        value: klass === 'honest_limit' ? 0 : 3,
        authority: 'FIRST_PARTY_MARKETPLACE_EVENT',
      });
      applyCorrection(sessionDoc, {
        key: 'median',
        value: 42,
        authority: 'FIRST_PARTY_MARKETPLACE_EVENT',
      });
      applyCorrection(sessionDoc, {
        key: 'seller_floor_usd',
        value: 40,
        authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
        source_actor: owner,
      });

      const turnRows = [];
      for (let t = 0; t < depth; t += 1) {
        const turn = appendConversationTurn(sessionDoc, {
          actor: owner,
          role: 'customer',
          content: `Full-eval turn ${t}`,
          turn_id: crypto.randomUUID(),
        });
        if (klass === 'correction' && t === Math.min(1, depth - 1)) {
          applyCorrection(sessionDoc, {
            key: 'condition',
            value: 'VG+',
            source_turn_id: turn.turn_id,
            source_actor: owner,
            authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
          });
        }
        const values = activeFactsMap(sessionDoc);
        const structured = structuredFor(capability, klass, values);
        const eligibility = decideModelEligibility({ capability, scenario_class: klass });
        const ids = createInferenceIds({ session_id, turn_index: t });

        const requested_mode = ['keyword', 'vector', 'hybrid'][sessionIndex % 3];
        const retrieval = retrieve({
          query: klass === 'honest_limit' ? 'zzznomatchxyz' : 'vinyl jazz classic',
          stores,
          store_names: ['catalog'],
          requested_mode,
          limit: 5,
          vectorIndex: requested_mode === 'keyword' ? null : store.toVectorIndex(),
          skipRightsFilter: true,
        });
        if (
          (requested_mode === 'vector' || requested_mode === 'hybrid') &&
          !retrieval.vector_executed &&
          !retrieval.fallback_reason
        ) {
          hard_failures.push({ session_id, reason: 'SILENT_RETRIEVAL_FALLBACK' });
        }

        const snapshot = {
          included_event_ids: docs.map((d) => d.market_event_id),
          evidence_snapshot_hash: sha(`full-${session_id}-${t}`),
        };

        let synthesis;
        let synthesis_label = 'GROUNDED DETERMINISTIC SYNTHESIS';
        let fallback_class = eligibility.fallback_class || FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY;
        let invoked = false;
        let success = false;

        if (eligibility.eligible) {
          const maxAttempts = 2; // bounded retry on transient timeout/unavailable
          let lastError = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
              synthesis = await synthesizeGrounded({
                capability,
                tier: 'privacy-local',
                structured_result: structured,
                evidence_summary: `${structured.sold_count || 0} eligible sales.`,
                modelGateway: gateway,
                snapshot,
              });
              if (!synthesis.model_invoked) {
                fallback_class = FALLBACK_CLASS.UNEXPECTED_RULE_FALLBACK;
                hard_failures.push({ session_id, reason: 'UNEXPECTED_RULE_FALLBACK' });
                synthesis = synthesizeDeterministic({ capability, structured_result: structured });
              } else {
                invoked = true;
                const claim_ledger = {
                  entries: Object.entries(structured)
                    .filter(([, v]) => typeof v === 'number')
                    .map(([k, v]) => ({
                      claim_type: k,
                      normalized_claim_value: v,
                      verification_result: 'SUPPORTED',
                    })),
                };
                const guarded = await guardWithRetry({
                  text: synthesis.direct_answer,
                  structured_result: structured,
                  claim_ledger,
                  synthesisInput: { capability, structured_result: structured },
                  retryOnce: async ({ violations }) => {
                    const banned = violations
                      .map((v) => v.claim?.raw)
                      .filter(Boolean)
                      .slice(0, 8)
                      .join(', ');
                    const retry = await gateway.complete({
                      capability,
                      structured_result: structured,
                      evidence_summary: `Retry. Do not use these unsupported values: ${banned}. Only JSON numbers.`,
                      snapshot,
                      inference_id: ids.inference_id,
                    });
                    return retry.direct_answer;
                  },
                });
                if (guarded.ok && !guarded.used_fallback) {
                  success = true;
                  fallback_class = FALLBACK_CLASS.NONE;
                  synthesis_label = 'GROUNDED MODEL SYNTHESIS';
                  synthesis = { ...synthesis, direct_answer: guarded.guarded_text };
                } else if (guarded.used_fallback) {
                  fallback_class = FALLBACK_CLASS.MODEL_GUARD_REJECTED;
                  hard_failures.push({
                    session_id,
                    turn_index: t,
                    reason: 'INVENTION_GUARD',
                    violations: (guarded.prior_violations || []).slice(0, 3),
                  });
                  fs.appendFileSync(
                    `${EVID}/ledgers/failures.jsonl`,
                    JSON.stringify({
                      session_id,
                      turn_index: t,
                      capability,
                      violations: guarded.prior_violations,
                      answer: String(synthesis.direct_answer || '').slice(0, 240),
                    }) + '\n',
                  );
                  synthesis = guarded.fallback_synthesis;
                } else {
                  fallback_class = FALLBACK_CLASS.MODEL_GUARD_REJECTED;
                  hard_failures.push({ session_id, reason: 'INVENTION_GUARD' });
                  synthesis = synthesizeDeterministic({ capability, structured_result: structured });
                }
              }
              if (synthesis.model_ledger) {
                synthesis.model_ledger.inference_id = ids.inference_id;
                synthesis.model_ledger.retry_count = attempt - 1;
                generationLatencies.push(
                  synthesis.model_ledger.generation_latency_ms ?? synthesis.model_ledger.total_latency_ms ?? null,
                );
                modelStream.write(
                  JSON.stringify({
                    session_id,
                    turn_index: t,
                    capability,
                    inference_id: ids.inference_id,
                    model_ledger: synthesis.model_ledger,
                    success,
                    fallback_class,
                    attempt,
                  }) + '\n',
                );
              }
              lastError = null;
              break;
            } catch (e) {
              lastError = e;
              const transient = /timeout|aborted|ECONNRESET|fetch failed/i.test(String(e.message));
              if (transient && attempt < maxAttempts) {
                process.stdout.write(
                  `retry_timeout session=${session_id} turn=${t} attempt=${attempt}\n`,
                );
                await new Promise((r) => setTimeout(r, 1500));
                continue;
              }
              fallback_class = /timeout|aborted/i.test(String(e.message))
                ? FALLBACK_CLASS.MODEL_TIMEOUT
                : FALLBACK_CLASS.MODEL_UNAVAILABLE;
              hard_failures.push({
                session_id,
                reason: fallback_class,
                error: String(e.message).slice(0, 120),
                attempts: attempt,
              });
              synthesis = synthesizeDeterministic({ capability, structured_result: structured });
            }
          }
          void lastError;
        } else {
          synthesis = synthesizeDeterministic({ capability, structured_result: structured });
        }

        if (capability === 'negotiation_assistance' && klass !== 'honest_limit' && t === depth - 1) {
          createDraft(sessionDoc, { body: structured.draft || 'Editable draft', status: 'GENERATED' });
        }

        const claim_values = Object.fromEntries(
          Object.entries(structured).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean'),
        );
        putCanonicalInference({
          ...ids,
          capability,
          class: klass,
          direct_answer: synthesis.direct_answer,
          structured_result: structured,
          evidence_snapshot_hash: snapshot.evidence_snapshot_hash,
          claim_values,
          synthesis_label,
          model_ledger: synthesis.model_ledger || null,
          canonical_request_hash: canonicalRequestHash({
            capability,
            structured_result: structured,
            evidence_snapshot_hash: snapshot.evidence_snapshot_hash,
            eligibility,
          }),
        });
        const protocol = verifyProtocolTriplet(ids.inference_id);
        if (!protocol.ok) hard_failures.push({ session_id, reason: 'PROTOCOL_MATERIAL_MISMATCH' });

        recordEligibilityOutcome(counters, { eligibility, invoked, success, fallback_class });
        turnRows.push({
          turn_index: t,
          inference_id: ids.inference_id,
          eligible: eligibility.eligible,
          model_success: success,
          protocol_ok: protocol.ok,
        });
      }

      sessionStream.write(
        JSON.stringify({
          session_id,
          capability,
          class: klass,
          depth,
          multi_turn: isMulti,
          turns: turnRows,
        }) + '\n',
      );

      if (sessionIndex % 100 === 0) {
        process.stdout.write(
          `progress ${sessionIndex}/${TOTAL} eligible=${counters.model_eligible_turns} success=${counters.model_success_turns} fail=${hard_failures.length}\n`,
        );
      }
      if (hard_failures.length > 0) {
        // Finish active logical unit (this session already done), stop releasing new sessions.
        stopNew = true;
        process.stdout.write(`FAIL_CLOSED at session=${sessionIndex} failures=${hard_failures.length}\n`);
      }
    }
  }
  sessionStream.end();
  modelStream.end();
  await finished(sessionStream);
  await finished(modelStream);

  const coverage = assertEligibilityCoverage(counters);
  const completedAll = !stopNew && sessionIndex === TOTAL;
  const ok =
    completedAll &&
    hard_failures.length === 0 &&
    coverage.ok &&
    counters.unexpected_rule_fallback_turns === 0 &&
    counters.model_success_turns === counters.model_eligible_turns &&
    multi_turn_sessions >= Math.floor(TOTAL * 0.25) &&
    multi_turn_sessions <= Math.ceil(TOTAL * 0.3) + 50;

  const latency = latencyReport(generationLatencies);
  const report = {
    ok,
    generated_at: new Date().toISOString(),
    evidence_root: EVID,
    sessions_total: sessionIndex,
    multi_turn_sessions,
    eligibility_preview: preview,
    eligibility_counters: counters,
    coverage,
    model_generation_latency_ms: latency,
    model_tier: gateway.model_tier,
    hard_failure_count: hard_failures.length,
    hard_failures: hard_failures.slice(0, 40),
    stop_new_sessions: stopNew,
    classification: ok
      ? [
          'PHASE 34 REAL MODEL FULL EVAL PASS —',
          `MODEL ELIGIBLE=${counters.model_eligible_turns} SUCCESS=${counters.model_success_turns} —`,
          'HUMAN REVIEW AND OWNER PACKAGE PENDING —',
          'PRODUCTION NOT APPROVED',
        ].join('\n')
      : [
          'PHASE 34 REAL MODEL FULL EVAL BLOCKED —',
          `SESSIONS=${sessionIndex}/${TOTAL} ELIGIBLE=${counters.model_eligible_turns} SUCCESS=${counters.model_success_turns} FAIL=${hard_failures.length} —`,
          'PRODUCTION NOT APPROVED',
        ].join('\n'),
    production: 'NOT APPROVED',
    model_weight_training: 'NO',
    chatgpt_tier_claimed: false,
  };
  fs.writeFileSync(`${EVID}/real-model-full-eval.json`, JSON.stringify(report, null, 2) + '\n');

  if (ok) {
    fs.mkdirSync(`${EVID}/FROZEN_PASS_EVIDENCE`, { recursive: true });
    fs.writeFileSync(
      `${EVID}/FROZEN_PASS_EVIDENCE/freeze.json`,
      JSON.stringify(
        {
          frozen_at: new Date().toISOString(),
          status: 'FROZEN_PASS',
          report: 'real-model-full-eval.json',
          report_sha256: sha(fs.readFileSync(`${EVID}/real-model-full-eval.json`)),
          model_eligible_turns: counters.model_eligible_turns,
          do_not_resume: true,
          do_not_mutate: true,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    fs.mkdirSync(`${EVID}/FROZEN_BLOCKED_EVIDENCE`, { recursive: true });
    fs.writeFileSync(
      `${EVID}/FROZEN_BLOCKED_EVIDENCE/freeze.json`,
      JSON.stringify(
        {
          frozen_at: new Date().toISOString(),
          status: 'FROZEN_BLOCKED',
          report: 'real-model-full-eval.json',
          report_sha256: sha(fs.readFileSync(`${EVID}/real-model-full-eval.json`)),
          sessions_completed: sessionIndex,
          hard_failure_count: hard_failures.length,
          do_not_resume: true,
          do_not_mutate: true,
        },
        null,
        2,
      ) + '\n',
    );
  }

  console.log(
    JSON.stringify(
      {
        ok,
        sessions: sessionIndex,
        multi_turn: multi_turn_sessions,
        model_eligible: counters.model_eligible_turns,
        model_success: counters.model_success_turns,
        hard_failures: hard_failures.length,
        latency_p50: latency.p50,
        latency_p99: latency.p99,
        classification: report.classification.split('\n')[0],
        out: `${EVID}/real-model-full-eval.json`,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
