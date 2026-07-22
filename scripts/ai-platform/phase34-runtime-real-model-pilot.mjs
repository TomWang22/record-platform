#!/usr/bin/env node
/**
 * Stage C — real-model pilot: 2,000 logical sessions.
 * All model-eligible turns must invoke the model. H1/H2/H3 share one inference.
 * Evidence: /tmp/phase34-real-model-pilot-v1
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EIGHT_CAPABILITIES } from '../lib/phase34-capability-response.mjs';
import { synthesizeDeterministic, synthesizeGrounded } from '../lib/phase34-grounded-synthesis.mjs';
import { createOllamaModelGateway } from '../lib/phase34-ollama-model-gateway.mjs';
import { guardInvention } from '../lib/phase34-invention-guard.mjs';
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

const EVID = process.env.PHASE34_EVIDENCE_ROOT || '/tmp/phase34-real-model-pilot-v1';
const TOTAL = Number(process.env.PHASE34_PILOT_SESSIONS || 2000);
const PER_CAP = TOTAL / EIGHT_CAPABILITIES.length; // 250
const MULTI_FRAC = 0.2;

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function classFor(j) {
  // Within each capability's 250 sessions
  if (j < 100) return 'success';
  if (j < 180) return 'correction';
  if (j < 215) return 'honest_limit';
  return 'adversarial';
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
    console.error(JSON.stringify({ ok: false, health }));
    process.exit(2);
  }

  const counters = emptyEligibilityCounters();
  const hard_failures = [];
  let multi_turn_sessions = 0;
  const sessionStream = fs.createWriteStream(`${EVID}/ledgers/sessions.jsonl`);
  let sessionIndex = 0;

  for (const capability of EIGHT_CAPABILITIES) {
    for (let j = 0; j < PER_CAP; j += 1) {
      const klass = classFor(j);
      const isMulti = j / PER_CAP < MULTI_FRAC && klass !== 'adversarial';
      const depth = isMulti ? 4 + (j % 5) : 1; // 4–8
      if (isMulti) multi_turn_sessions += 1;

      const session_id = `rmp-${String(sessionIndex).padStart(5, '0')}`;
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
          content: `Pilot turn ${t}`,
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
          evidence_snapshot_hash: sha(`pilot-${session_id}-${t}`),
        };

        let synthesis;
        let synthesis_label = 'GROUNDED DETERMINISTIC SYNTHESIS';
        let fallback_class = eligibility.fallback_class || FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY;
        let invoked = false;
        let success = false;

        if (eligibility.eligible) {
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
              const invention = guardInvention({
                text: synthesis.direct_answer,
                structured_result: structured,
                claim_ledger: {
                  entries: Object.entries(structured)
                    .filter(([, v]) => typeof v === 'number')
                    .map(([k, v]) => ({
                      claim_type: k,
                      normalized_claim_value: v,
                      verification_result: 'SUPPORTED',
                    })),
                },
              });
              if (invention.ok === false) {
                fallback_class = FALLBACK_CLASS.MODEL_GUARD_REJECTED;
                hard_failures.push({ session_id, reason: 'INVENTION_GUARD' });
                synthesis = synthesizeDeterministic({ capability, structured_result: structured });
              } else {
                success = true;
                fallback_class = FALLBACK_CLASS.NONE;
                synthesis_label = 'GROUNDED MODEL SYNTHESIS';
              }
            }
            if (synthesis.model_ledger) synthesis.model_ledger.inference_id = ids.inference_id;
          } catch (e) {
            fallback_class = /timeout|aborted/i.test(String(e.message))
              ? FALLBACK_CLASS.MODEL_TIMEOUT
              : FALLBACK_CLASS.MODEL_UNAVAILABLE;
            hard_failures.push({ session_id, reason: fallback_class, error: String(e.message).slice(0, 120) });
            synthesis = synthesizeDeterministic({ capability, structured_result: structured });
          }
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
      if (hard_failures.length > 0 && process.env.PHASE34_FAIL_CLOSED === '1') break;
    }
  }
  sessionStream.end();

  const coverage = assertEligibilityCoverage(counters);
  const ok =
    sessionIndex === TOTAL &&
    hard_failures.length === 0 &&
    coverage.ok &&
    counters.unexpected_rule_fallback_turns === 0 &&
    counters.model_success_turns === counters.model_eligible_turns &&
    multi_turn_sessions >= Math.floor(TOTAL * MULTI_FRAC) - 50; // allow small class-filter variance

  const report = {
    ok,
    generated_at: new Date().toISOString(),
    evidence_root: EVID,
    sessions_total: sessionIndex,
    multi_turn_sessions,
    eligibility_counters: counters,
    coverage,
    model_tier: gateway.model_tier,
    hard_failure_count: hard_failures.length,
    hard_failures: hard_failures.slice(0, 40),
    classification: ok
      ? [
          'PHASE 34 REAL MODEL PILOT PASS —',
          `MODEL ELIGIBLE=${counters.model_eligible_turns} SUCCESS=${counters.model_success_turns} —`,
          'FULL REAL-INFERENCE EVAL PENDING —',
          'PRODUCTION NOT APPROVED',
        ].join('\n')
      : ['PHASE 34 REAL MODEL PILOT BLOCKED —', 'PRODUCTION NOT APPROVED'].join('\n'),
    production: 'NOT APPROVED',
    model_weight_training: 'NO',
    chatgpt_tier_claimed: false,
  };
  fs.writeFileSync(`${EVID}/real-model-pilot.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        ok,
        sessions: sessionIndex,
        multi_turn: multi_turn_sessions,
        model_eligible: counters.model_eligible_turns,
        model_success: counters.model_success_turns,
        hard_failures: hard_failures.length,
        classification: report.classification.split('\n')[0],
        out: `${EVID}/real-model-pilot.json`,
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
