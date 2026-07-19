/**
 * Unit coverage for Phase 34 response-depth contract + response dossiers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  DOSSIER_JSON_REQUIRED_FIELDS,
  validateResponseDossier,
  renderResponseDossierMarkdown,
  validateNegotiationTranscript,
  scoreResponseQuality,
  assertGoldenAcceptance,
  assertCrossResponseChecks,
} from '../scripts/lib/phase34-response-dossier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(REPO, 'scripts/ai-platform/fixtures/phase34-response-dossiers');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

test('response-depth contract lists answer modes and recorded fields', () => {
  const contract = JSON.parse(
    fs.readFileSync(
      path.join(REPO, 'scripts/ai-platform/phase34-response-depth-contract.json'),
      'utf8',
    ),
  );
  assert.deepEqual(contract.answer_modes, ['COMPACT', 'STANDARD', 'DEEP', 'CONVERSATIONAL']);
  assert.equal(contract.model_weight_training, 'NO');
  assert.equal(
    contract.current_optimization,
    'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
  );
  for (const field of [
    'answer_mode',
    'word_count',
    'character_count',
    'estimated_input_tokens',
    'estimated_output_tokens',
    'section_count',
    'evidence_count',
    'material_claim_count',
    'citation_count',
    'sentence_count',
    'reading_time_seconds',
    'truncation_status',
    'requested_detail_level',
  ]) {
    assert.ok(contract.every_response_records.includes(field), field);
  }
  assert.equal(contract.suggested_product_targets.scarcity.STANDARD.min_words, 250);
  assert.equal(contract.suggested_product_targets.honest_limit.max_words, 250);
});

test('dossier required fields match plan section 10', () => {
  const expected = [
    'scenario_id',
    'session_id',
    'turn_id',
    'participant_side',
    'visible_user_prompt',
    'context_summary',
    'subject_identity',
    'evidence_snapshot_id',
    'evidence_snapshot_hash',
    'full_response_text',
    'direct_answer',
    'reasoning_summary',
    'key_values',
    'what_changed',
    'evidence_items',
    'claim_evidence_map',
    'uncertainties',
    'limitations',
    'next_action',
    'editable_draft',
    'word_count',
    'character_count',
    'input_token_estimate',
    'output_token_estimate',
    'response_mode',
    'browser_latency',
    'pipeline_latency',
    'H1_status',
    'H2_status',
    'H3_status',
    'protocol_parity',
    'quality_scores',
    'human_review_status',
  ];
  assert.deepEqual([...DOSSIER_JSON_REQUIRED_FIELDS], expected);
});

test('fixture dossiers validate, render, score, and pass golden gates', () => {
  const scarcity = loadFixture('scarcity-success-exact-pressing.json');
  const honest = loadFixture('valuation-honest-limit-weak-comps.json');
  const negotiation = loadFixture('negotiation-four-turn-transcript.json');

  validateResponseDossier(scarcity);
  validateResponseDossier(honest);
  validateResponseDossier(negotiation.dossier);

  const md = renderResponseDossierMarkdown(scarcity);
  assert.match(md, /## User asked/);
  assert.match(md, /## Full response/);
  assert.match(md, /## Technical details/);

  const transcript = validateNegotiationTranscript({ turns: negotiation.turns });
  assert.equal(transcript.exchange_count, 4);

  assertGoldenAcceptance(scoreResponseQuality(scarcity));
  assertGoldenAcceptance(scoreResponseQuality(honest));
  assertGoldenAcceptance(scoreResponseQuality(negotiation.dossier), {
    pressing_applicable: false,
  });
  assertCrossResponseChecks([scarcity, honest, negotiation.dossier]);
});

test('cross-response checks reject shared unrelated answers', () => {
  const scarcity = loadFixture('scarcity-success-exact-pressing.json');
  const clone = {
    ...structuredClone(scarcity),
    scenario_id: 'valuation-clone',
    capability: 'valuation',
    scenario_class: 'A_success',
  };
  assert.throws(() => assertCrossResponseChecks([scarcity, clone]), /unrelated capabilities/);
});

test('finetuning corpus registry stays DISABLED', () => {
  const finetune = JSON.parse(
    fs.readFileSync(
      path.join(REPO, 'scripts/ai-platform/phase34-finetuning-corpus-registry.json'),
      'utf8',
    ),
  );
  assert.equal(finetune.status, 'DISABLED');
  assert.equal(finetune.auto_copy_from_retrieval, false);
  assert.ok(finetune.required_future_fields.includes('rights_approval'));
  assert.equal(finetune.entries.length, 0);
});

test('depth, dossier, and corpus verifiers exit 0', () => {
  for (const script of [
    'scripts/ai-platform/verify-phase34-response-depth.mjs',
    'scripts/ai-platform/verify-phase34-response-dossier.mjs',
    'scripts/ai-platform/verify-phase34-corpus-registries.mjs',
  ]) {
    const out = execFileSync('node', [script], { cwd: REPO, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
  }
});
