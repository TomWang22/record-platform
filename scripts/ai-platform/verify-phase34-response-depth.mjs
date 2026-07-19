#!/usr/bin/env node
/**
 * Verify Phase 34 response-depth contract (structure + product targets).
 * Does not claim ChatGPT-tier depth proven in live owner-proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.join(__dirname, 'phase34-response-depth-contract.json');
const SCHEMA = path.join(__dirname, 'phase34-response-depth-contract.schema.json');

const REQUIRED_ANSWER_MODES = ['COMPACT', 'STANDARD', 'DEEP', 'CONVERSATIONAL'];

const REQUIRED_RECORDED_FIELDS = [
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
];

const REQUIRED_GENERAL_REQUIREMENT_FRAGMENTS = [
  'first two sentences',
  'pad',
  'omit reasoning',
  'headings',
  'facts',
  'uncertainty',
  'next action',
  'repeat the prompt',
  'generic limitations',
];

const REQUIRED_TARGET_KEYS = [
  'scarcity',
  'valuation',
  'auction',
  'embeddings',
  'semantic_search',
  'negotiation',
  'recommendations',
  'market_analytics',
  'honest_limit',
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'RESPONSE_DEPTH_CONTRACT_FAIL';
    throw err;
  }
}

function rangeOk(obj, minKey, maxKey, expectedMin, expectedMax) {
  assert(obj && typeof obj === 'object', 'missing range object');
  assert(obj[minKey] === expectedMin, `expected ${minKey}=${expectedMin}, got ${obj[minKey]}`);
  assert(obj[maxKey] === expectedMax, `expected ${maxKey}=${expectedMax}, got ${obj[maxKey]}`);
}

function main() {
  assert(fs.existsSync(CONTRACT), 'missing response depth contract');
  assert(fs.existsSync(SCHEMA), 'missing response depth schema');
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));

  assert(contract.model_weight_training === 'NO', 'MODEL_WEIGHT_TRAINING must be NO');
  assert(
    contract.current_optimization ===
      'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    'current_optimization mismatch',
  );
  assert(contract.length_targets_are_ranges_not_padding === true, 'ranges must not be padding');

  for (const mode of REQUIRED_ANSWER_MODES) {
    assert(contract.answer_modes.includes(mode), `missing answer mode ${mode}`);
  }
  for (const f of REQUIRED_RECORDED_FIELDS) {
    assert(contract.every_response_records.includes(f), `missing recorded field ${f}`);
  }

  const reqText = (contract.general_requirements || []).join(' ').toLowerCase();
  for (const frag of REQUIRED_GENERAL_REQUIREMENT_FRAGMENTS) {
    assert(reqText.includes(frag.toLowerCase()), `general_requirements missing fragment: ${frag}`);
  }

  const targets = contract.suggested_product_targets || {};
  for (const key of REQUIRED_TARGET_KEYS) {
    assert(targets[key], `missing suggested_product_targets.${key}`);
  }

  rangeOk(targets.scarcity.STANDARD, 'min_words', 'max_words', 250, 550);
  rangeOk(targets.scarcity.DEEP, 'min_words', 'max_words', 550, 1100);
  rangeOk(targets.valuation.STANDARD, 'min_words', 'max_words', 300, 700);
  rangeOk(targets.valuation.DEEP, 'min_words', 'max_words', 650, 1300);
  rangeOk(targets.auction.STANDARD, 'min_words', 'max_words', 350, 800);
  rangeOk(targets.auction.DEEP, 'min_words', 'max_words', 700, 1400);
  rangeOk(targets.embeddings.STANDARD, 'min_words', 'max_words', 150, 400);
  rangeOk(targets.semantic_search.narrative, 'min_words', 'max_words', 120, 300);
  assert(targets.semantic_search.min_structured_result_cards >= 5, 'semantic_search cards');
  rangeOk(targets.negotiation.strategy, 'min_words', 'max_words', 250, 650);
  rangeOk(targets.negotiation.draft, 'min_words', 'max_words', 50, 140);
  rangeOk(targets.negotiation.long_thread_summary, 'min_words', 'max_words', 150, 400);
  rangeOk(targets.recommendations.narrative, 'min_words', 'max_words', 150, 350);
  assert(targets.recommendations.min_structured_cards >= 5, 'recommendations cards');
  rangeOk(targets.market_analytics.STANDARD, 'min_words', 'max_words', 350, 850);
  rangeOk(targets.market_analytics.DEEP, 'min_words', 'max_words', 750, 1500);
  assert(targets.honest_limit.min_words === 80, 'honest_limit min');
  assert(targets.honest_limit.max_words === 250, 'honest_limit max');
  assert(
    Array.isArray(targets.honest_limit.must_explain) &&
      targets.honest_limit.must_explain.length >= 4,
    'honest_limit must_explain',
  );

  try {
    const require = createRequire(import.meta.url);
    const Ajv = require('ajv').default || require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    assert(validate(contract), JSON.stringify(validate.errors));
  } catch (err) {
    if (err.code === 'RESPONSE_DEPTH_CONTRACT_FAIL') throw err;
    // ajv optional
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        response_depth_contract_hash: sha256File(CONTRACT),
        response_depth_schema_hash: sha256File(SCHEMA),
        answer_modes: contract.answer_modes.length,
        every_response_records: contract.every_response_records.length,
        chatgpt_tier_claim: false,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
        code: err.code || 'RESPONSE_DEPTH_CONTRACT_FAIL',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
