#!/usr/bin/env node
/**
 * Stage B — real-model canary: 240 logical sessions, model on ALL eligible turns.
 * Expected eligible denominator: 112 (7 synthesis caps × 16 success/correction).
 * Evidence: /tmp/phase34-real-model-canary-v1
 * llama3.2:1b = TRANSPORT_AND_SMOKE_ONLY / MODEL_TIER_INSUFFICIENT for product quality.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EIGHT_CAPABILITIES } from '../lib/phase34-capability-response.mjs';
import { synthesizeDeterministic, synthesizeGrounded } from '../lib/phase34-grounded-synthesis.mjs';
import { createOllamaModelGateway } from '../lib/phase34-ollama-model-gateway.mjs';
import { guardInvention, guardWithRetry } from '../lib/phase34-invention-guard.mjs';
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

const EVID = process.env.PHASE34_EVIDENCE_ROOT || '/tmp/phase34-real-model-canary-v1';
const SESSIONS_PER_CAP = 30;
/** Balanced toward synthesis: ≥20 model-backed turns per synthesis capability. */
function classFor(j) {
  if (j < 12) return 'success';
  if (j < 22) return 'correction';
  if (j < 26) return 'honest_limit';
  return 'adversarial';
}

function expectedEligible() {
  let n = 0;
  for (const capability of EIGHT_CAPABILITIES) {
    for (let j = 0; j < SESSIONS_PER_CAP; j += 1) {
      if (decideModelEligibility({ capability, scenario_class: classFor(j) }).eligible) n += 1;
    }
  }
  return n;
}
const EXPECTED_ELIGIBLE = expectedEligible();

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function structuredFor(capability, klass) {
  if (klass === 'honest_limit') {
    return {
      sold_count: 0,
      sample_size: 0,
      currency: 'USD',
      conclusion: 'I do not have enough eligible evidence.',
      limitations: ['INSUFFICIENT_EVIDENCE'],
      confidence: 'low',
      automatic_send_allowed: false,
      message_sent: false,
      draft: '',
    };
  }
  const base = {
    sold_count: 3,
    median: 42,
    currency: 'USD',
    fair_low: 35,
    fair_high: 50,
    seller_floor: 40,
    conclusion: 'Completed-sale median is 42 USD across 3 sales.',
    confidence: 'medium',
    automatic_send_allowed: false,
    message_sent: false,
    draft: 'Would you consider 40 USD VG+ shipping included?',
  };
  if (capability === 'scarcity') return { ...base, scarcity_label: 'moderate', exact_pressing: true };
  if (capability === 'auction_intelligence') return { ...base, watchers: 12, bid_count: 4 };
  if (capability === 'recommendations') return { ...base, candidate_count: 5, budget_max: 60 };
  if (capability === 'market_analytics') return { ...base, population: 3, time_window_days: 90 };
  return base;
}

async function main() {
  clearCanonicalInferenceStore();
  fs.mkdirSync(`${EVID}/ledgers`, { recursive: true });

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
    timeoutMs: Number(process.env.PHASE34_OLLAMA_TIMEOUT_MS || 120000),
  });

  const health = await gateway.health();
  if (!health.ok) {
    console.error(JSON.stringify({ ok: false, reason: 'GATEWAY_HEALTH_FAIL', health }, null, 2));
    process.exit(2);
  }

  process.stdout.write(`expected_eligible=${EXPECTED_ELIGIBLE}\n`);

  const counters = emptyEligibilityCounters();
  const hard_failures = [];
  const sessions = [];
  const model_by_capability = {};

  for (const capability of EIGHT_CAPABILITIES) {
    for (let i = 0; i < SESSIONS_PER_CAP; i += 1) {
      const klass = classFor(i);
      const session_id = `rmc-${capability}-${klass}-${i}`;
      const ids = createInferenceIds({ session_id, turn_index: 0 });
      const structured = structuredFor(capability, klass);
      const eligibility = decideModelEligibility({
        capability,
        scenario_class: klass,
      });

      const modes = ['keyword', 'vector', 'hybrid', 'keyword'];
      const requested_mode = modes[i % modes.length];
      const retrieval = retrieve({
        query: klass === 'honest_limit' ? 'zzznomatchxyz' : 'vinyl jazz classic',
        stores,
        store_names: ['catalog'],
        requested_mode: requested_mode === 'keyword' ? 'keyword' : requested_mode,
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
        evidence_snapshot_hash: sha(`snap-${session_id}`),
      };

      let synthesis;
      let synthesis_label = 'GROUNDED DETERMINISTIC SYNTHESIS';
      let fallback_class = eligibility.fallback_class || FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY;
      let invoked = false;
      let success = false;

      if (eligibility.eligible) {
        try {
          process.stdout.write(`model_start ${capability} ${session_id}\n`);
          synthesis = await synthesizeGrounded({
            capability,
            tier: 'privacy-local',
            structured_result: structured,
            evidence_summary: `${structured.sold_count || 0} eligible sales.`,
            modelGateway: gateway,
            snapshot,
          });
          // Attach inference id into ledger if present
          if (synthesis.model_ledger) {
            synthesis.model_ledger.inference_id = ids.inference_id;
          }
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
                  evidence_summary: `Retry. Forbidden values: ${banned}. Only JSON numbers.`,
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
              model_by_capability[capability] = (model_by_capability[capability] || 0) + 1;
            } else {
              fallback_class = FALLBACK_CLASS.MODEL_GUARD_REJECTED;
              hard_failures.push({
                session_id,
                reason: 'INVENTION_GUARD',
                violations: (guarded.prior_violations || guarded.violations || []).slice(0, 3),
              });
              synthesis = guarded.fallback_synthesis || synthesizeDeterministic({ capability, structured_result: structured });
              synthesis_label = 'GROUNDED MODEL SYNTHESIS BLOCKED_BY_INVENTION_GUARD';
            }
          }
          process.stdout.write(`model_done ${capability} success=${success}\n`);
        } catch (e) {
          const code = e.code || (/timeout|aborted/i.test(String(e.message)) ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE');
          fallback_class =
            code === 'MODEL_TIMEOUT' ? FALLBACK_CLASS.MODEL_TIMEOUT : FALLBACK_CLASS.MODEL_UNAVAILABLE;
          hard_failures.push({ session_id, reason: code, error: String(e.message || e).slice(0, 160) });
          synthesis = synthesizeDeterministic({
            capability,
            structured_result: structured,
            limitations: [code],
          });
        }
      } else {
        synthesis = synthesizeDeterministic({
          capability,
          structured_result: structured,
          evidence_summary:
            klass === 'honest_limit' ? 'No eligible evidence.' : 'Deterministic-only by policy.',
        });
        fallback_class = FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY;
      }

      if (capability === 'negotiation_assistance' && klass !== 'honest_limit') {
        if (structured.automatic_send_allowed !== false || structured.message_sent !== false) {
          hard_failures.push({ session_id, reason: 'AUTOMATIC_SEND' });
        }
      }

      const claim_values = Object.fromEntries(
        Object.entries(structured).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean'),
      );

      const canonical = putCanonicalInference({
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
      if (!protocol.ok) {
        hard_failures.push({ session_id, reason: 'PROTOCOL_MATERIAL_MISMATCH' });
      }

      recordEligibilityOutcome(counters, {
        eligibility,
        invoked,
        success,
        fallback_class,
      });

      sessions.push({
        session_id,
        capability,
        class: klass,
        eligible: eligibility.eligible,
        eligibility_reason: eligibility.reason,
        model_invoked: invoked,
        model_success: success,
        fallback_class,
        synthesis_label,
        inference_id: ids.inference_id,
        accepted_response_hash: canonical.accepted_response_hash,
        protocol_ok: protocol.ok,
        executed_mode: retrieval.executed_mode,
      });
    }
  }

  fs.writeFileSync(`${EVID}/ledgers/sessions.jsonl`, sessions.map((s) => JSON.stringify(s)).join('\n') + '\n');

  const coverage = assertEligibilityCoverage(counters);
  const synthCaps = EIGHT_CAPABILITIES.filter((c) => c !== 'embeddings');
  const capsOk = synthCaps.every((c) => (model_by_capability[c] || 0) >= 20);
  const ok =
    sessions.length === 240 &&
    hard_failures.length === 0 &&
    coverage.ok &&
    counters.model_eligible_turns === EXPECTED_ELIGIBLE &&
    counters.model_success_turns === EXPECTED_ELIGIBLE &&
    counters.unexpected_rule_fallback_turns === 0 &&
    capsOk;

  const report = {
    ok,
    generated_at: new Date().toISOString(),
    evidence_root: EVID,
    sessions_total: sessions.length,
    expected_eligible_turns: EXPECTED_ELIGIBLE,
    eligibility_counters: counters,
    coverage,
    model_success_by_capability: model_by_capability,
    model_tier: gateway.model_tier,
    hard_failures: hard_failures.slice(0, 40),
    hard_failure_count: hard_failures.length,
    classification: ok
      ? [
          'PHASE 34 REAL MODEL CANARY PASS —',
          `MODEL ELIGIBLE TURNS ${counters.model_eligible_turns}/${EXPECTED_ELIGIBLE} INVOKED AND VERIFIED —`,
          `MODEL TIER=${gateway.model_tier.role} PRODUCT_QUALITY=${gateway.model_tier.product_quality} —`,
          'CANONICAL H1/H2/H3 INFERENCE DEDUP VERIFIED —',
          'PILOT PENDING —',
          'PRODUCTION NOT APPROVED',
        ].join('\n')
      : [
          'PHASE 34 REAL MODEL CANARY BLOCKED —',
          `eligible=${counters.model_eligible_turns} success=${counters.model_success_turns} unexpected_fallback=${counters.unexpected_rule_fallback_turns} —`,
          'PRODUCTION NOT APPROVED',
        ].join('\n'),
    production: 'NOT APPROVED',
    model_weight_training: 'NO',
    chatgpt_tier_claimed: false,
  };

  fs.writeFileSync(`${EVID}/real-model-canary.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        ok,
        sessions: sessions.length,
        expected_eligible: EXPECTED_ELIGIBLE,
        model_eligible: counters.model_eligible_turns,
        model_success: counters.model_success_turns,
        unexpected_fallback: counters.unexpected_rule_fallback_turns,
        hard_failures: hard_failures.length,
        classification: report.classification.split('\n')[0],
        out: `${EVID}/real-model-canary.json`,
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
