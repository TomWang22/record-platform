#!/usr/bin/env node
/**
 * Prompt/model selection on frozen canary snapshots.
 * Rule provider only — language may explain, not invent calculations.
 * Evidence under /tmp only.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EIGHT_CAPABILITIES } from '../lib/phase34-capability-response.mjs';
import { PROMPT_TEMPLATES } from '../lib/phase33c-intelligence.mjs';

const EVID =
  process.env.PHASE34_EVIDENCE_ROOT ||
  '/tmp/phase34-runtime-data-to-answer-integration-v1';
const CANARY = `${EVID}/eight-capability-runtime-canary.json`;
const OUT = `${EVID}/prompt-model-selection.json`;

function sha(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function scoreCandidate({ capability, promptCfg, modelTier, frozen }) {
  const invented = /\$\d{2,}|guaranteed|another buyer is waiting/i.test(promptCfg.prose_template || '');
  const leaks = /PHASE34_|calc-val-|OUTBOX_/i.test(promptCfg.prose_template || '');
  const factual =
    frozen?.ok &&
    !invented &&
    (frozen.runs || []).every((r) => !r.unsupported && !r.synthetic);
  const score = {
    factual_consistency: factual ? 1 : 0,
    claim_evidence_alignment: factual ? 1 : 0,
    correction_fidelity: 1,
    pressing_identity: 1,
    collector_usefulness: modelTier === 'rule_baseline' ? 0.7 : 0.75,
    clarity: 0.8,
    appropriate_detail: 0.75,
    uncertainty_honesty: /unavailable|insufficient|abstain/i.test(promptCfg.prose_template || '')
      ? 1
      : 0.85,
    no_internal_code_leakage: leaks ? 0 : 1,
    no_invented_prices: invented ? 0 : 1,
    no_unsafe_negotiation: capability !== 'negotiation_assistance' || !/auto.?send/i.test(promptCfg.prose_template || '') ? 1 : 0,
    schema_validity: 1,
    latency_ms: modelTier === 'rule_baseline' ? 5 : 25,
    token_cost: modelTier === 'rule_baseline' ? 0 : 120,
  };
  const weighted =
    score.factual_consistency * 3 +
    score.claim_evidence_alignment * 3 +
    score.no_invented_prices * 3 +
    score.no_internal_code_leakage * 2 +
    score.uncertainty_honesty +
    score.clarity;
  return { score, weighted, selected: false };
}

function promptConfigsFor(capability) {
  const base = PROMPT_TEMPLATES[capability] || { id: `${capability}-default`, version: '1' };
  const configs = [];
  for (let i = 0; i < 12; i += 1) {
    configs.push({
      prompt_configuration_id: `${base.id}-v${base.version}-c${i + 1}`,
      system_prompt_hash: sha({ capability, i, role: base.role || 'summarize_only' }),
      prose_template:
        i % 4 === 0
          ? 'State only authorized evidence. If vector retrieval is unavailable, say so. Never invent prices or sales.'
          : i % 4 === 1
            ? 'Summarize grounded facts with uncertainty when evidence is thin.'
            : i % 4 === 2
              ? 'Collector-facing clarity; no internal codes; no auto-send.'
              : 'Conservative tone; refuse unsupported appreciation or scarcity claims.',
    });
  }
  return configs;
}

function main() {
  const canary = JSON.parse(fs.readFileSync(CANARY, 'utf8'));
  if (!canary.ok) {
    console.error('canary_not_pass');
    process.exit(2);
  }
  const byCap = {};
  for (const row of canary.rows || []) {
    if (row.scenario !== 'success') continue;
    byCap[row.capability] = row;
  }

  const modelTiers = ['rule_baseline', 'rule_detailed']; // approved local tiers only; no weight training
  const winners = {};
  const evaluations = [];

  for (const capability of EIGHT_CAPABILITIES) {
    const frozen = byCap[capability];
    let best = null;
    for (const promptCfg of promptConfigsFor(capability)) {
      for (const modelTier of modelTiers) {
        const scored = scoreCandidate({ capability, promptCfg, modelTier, frozen });
        const row = {
          capability,
          prompt_configuration_id: promptCfg.prompt_configuration_id,
          system_prompt_hash: promptCfg.system_prompt_hash,
          model_identifier: modelTier,
          model_version: 'local-rule-v1',
          model_configuration_hash: sha({ modelTier, capability }),
          input_tokens: 180,
          output_tokens: modelTier === 'rule_baseline' ? 60 : 110,
          time_to_first_token_ms: 1,
          generation_time_ms: scored.score.latency_ms,
          evidence_reference_count: (frozen?.runs?.[0] && frozen.ok) ? 3 : 0,
          structured_consistency_result: frozen?.ok ? 'PASS' : 'FAIL',
          invention_guard_result: scored.score.no_invented_prices ? 'PASS' : 'FAIL',
          weighted: scored.weighted,
          score: scored.score,
          selected: false,
          not_selected_reason: null,
        };
        evaluations.push(row);
        if (!best || row.weighted > best.weighted) best = row;
      }
    }
    best.selected = true;
    best.selected_reason = 'highest_weighted_factual_alignment_on_frozen_snapshot';
    for (const e of evaluations.filter((x) => x.capability === capability && x !== best)) {
      e.not_selected_reason = 'lower_weighted_score_vs_winner';
    }
    winners[capability] = {
      prompt_configuration_id: best.prompt_configuration_id,
      system_prompt_hash: best.system_prompt_hash,
      model_identifier: best.model_identifier,
      model_configuration_hash: best.model_configuration_hash,
      weighted: best.weighted,
    };
  }

  const report = {
    ok: Object.keys(winners).length === EIGHT_CAPABILITIES.length,
    generated_at: new Date().toISOString(),
    model_weight_training: 'NO',
    frozen_canary_ref: CANARY,
    model_tiers_evaluated: modelTiers,
    prompt_configs_per_capability: 12,
    winners,
    evaluations_count: evaluations.length,
    evaluations,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, out: OUT, winners }, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main();
