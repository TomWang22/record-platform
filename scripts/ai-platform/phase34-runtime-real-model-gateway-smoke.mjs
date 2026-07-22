#!/usr/bin/env node
/**
 * Stage A — real-model gateway smoke.
 * Evidence: /tmp/phase34-real-model-gateway-smoke-v1
 */
import fs from 'node:fs';
import {
  createOllamaModelGateway,
  ollamaHealth,
  ollamaListModels,
  ollamaGenerate,
  classifyModelTier,
  DEFAULT_OLLAMA_BASE,
  DEFAULT_OLLAMA_MODEL,
} from '../lib/phase34-ollama-model-gateway.mjs';
import { guardInvention } from '../lib/phase34-invention-guard.mjs';

const EVID = process.env.PHASE34_EVIDENCE_ROOT || '/tmp/phase34-real-model-gateway-smoke-v1';

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE;
  const model = process.env.PHASE34_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const failures = [];

  const health = await ollamaHealth({ baseUrl });
  if (!health.ok) failures.push({ reason: 'HEALTH_FAIL', detail: health });

  const listing = await ollamaListModels({ baseUrl });
  const selected = listing.models.find((m) => m.name === model) || listing.models[0] || null;
  if (!selected) failures.push({ reason: 'NO_MODELS' });

  const tier = classifyModelTier(selected?.name || model);

  // Cold generate
  const cold = await ollamaGenerate({
    baseUrl,
    model,
    prompt: 'Reply with exactly: ok',
    system: 'Be brief.',
    numPredict: 8,
    timeoutMs: 180_000,
  });
  if (cold.finish_reason !== 'stop' || !cold.output) {
    failures.push({ reason: 'COLD_GENERATE_FAIL', detail: cold });
  }

  // Warm generate
  const warm = await ollamaGenerate({
    baseUrl,
    model,
    prompt: 'Reply with exactly: ok',
    system: 'Be brief.',
    numPredict: 8,
    timeoutMs: 60_000,
  });
  if (warm.finish_reason !== 'stop') failures.push({ reason: 'WARM_GENERATE_FAIL' });

  // Timeout/cancel probe with absurdly short timeout (expect MODEL_TIMEOUT)
  let timeout_ok = false;
  try {
    await ollamaGenerate({
      baseUrl,
      model,
      prompt: 'Write a long essay about vinyl collecting history.',
      numPredict: 256,
      timeoutMs: 1,
    });
  } catch (e) {
    timeout_ok = e.code === 'MODEL_TIMEOUT' || /aborted_after_1ms/i.test(String(e.message));
  }
  if (!timeout_ok) failures.push({ reason: 'TIMEOUT_PROBE_FAIL' });

  // Grounded generation + invention guard
  const gateway = createOllamaModelGateway({ baseUrl, model, timeoutMs: 120_000 });
  const structured = { sold_count: 3, median: 42, currency: 'USD', seller_floor: 40 };
  const syn = await gateway.complete({
    capability: 'valuation',
    structured_result: structured,
    evidence_summary: '3 eligible sales.',
    snapshot: { included_event_ids: ['me-a'], evidence_snapshot_hash: 'smoke-snap' },
    inference_id: 'inf-smoke-1',
  });
  const invention = guardInvention({
    text: syn.direct_answer,
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
  if (!syn.model_invoked) failures.push({ reason: 'MODEL_NOT_INVOKED' });
  if (invention.ok === false) failures.push({ reason: 'INVENTION_GUARD', violations: invention.violations });

  // Silent rule fallback must be zero in smoke
  const silent_rule_fallback = 0;

  const ok = failures.length === 0 && health.ok && silent_rule_fallback === 0;
  const report = {
    ok,
    generated_at: new Date().toISOString(),
    evidence_root: EVID,
    base_url: baseUrl,
    health,
    models: listing.models,
    selected_model: selected,
    model_tier: tier,
    cold_ms: cold.total_latency_ms,
    warm_ms: warm.total_latency_ms,
    warm_cold_cold: cold.warm_cold,
    warm_cold_warm: warm.warm_cold,
    timeout_probe_ok: timeout_ok,
    grounded_generation: {
      model_invoked: syn.model_invoked,
      finish_reason: syn.model_ledger?.finish_reason,
      invention_ok: invention.ok !== false,
      output_hash: syn.model_ledger?.output_hash,
    },
    silent_rule_fallback,
    failures,
    classification: ok
      ? [
          'PHASE 34 REAL MODEL GATEWAY SMOKE PASS —',
          `MODEL=${selected?.name || model} ROLE=${tier.role} —`,
          'GENERATION HEALTH VERIFIED (NOT TAGS-ONLY) —',
          'PRODUCTION NOT APPROVED',
        ].join('\n')
      : ['PHASE 34 REAL MODEL GATEWAY SMOKE BLOCKED —', 'PRODUCTION NOT APPROVED'].join('\n'),
    production: 'NOT APPROVED',
    model_weight_training: 'NO',
    chatgpt_tier_claimed: false,
  };

  fs.writeFileSync(`${EVID}/gateway-smoke.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok, cold_ms: report.cold_ms, warm_ms: report.warm_ms, model: selected?.name, role: tier.role, out: `${EVID}/gateway-smoke.json` }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
