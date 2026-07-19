#!/usr/bin/env node
/**
 * Verify Phase 34 response-quality contract (structure + golden gates).
 * Does not claim ChatGPT-tier quality proven.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.join(__dirname, 'phase34-response-quality-contract.json');
const SCHEMA = path.join(__dirname, 'phase34-response-quality-contract.schema.json');

const REQUIRED_FIELDS = [
  'direct_answer',
  'reasoning_summary',
  'key_values',
  'what_changed',
  'evidence',
  'uncertainties',
  'limitations',
  'recommended_next_action',
  'editable_draft',
  'safety_status',
  'developer_details',
];

const REQUIRED_RUBRICS = [
  'grounded_factuality',
  'question_answering_directness',
  'usefulness',
  'specificity',
  'context_retention',
  'correction_handling',
  'uncertainty_calibration',
  'evidence_alignment',
  'customer_language_quality',
  'actionability',
  'non_repetition',
  'safety',
  'privacy',
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'RESPONSE_QUALITY_CONTRACT_FAIL';
    throw err;
  }
}

function main() {
  assert(fs.existsSync(CONTRACT), 'missing response quality contract');
  assert(fs.existsSync(SCHEMA), 'missing response quality schema');
  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));

  assert(contract.model_weight_training === 'NO', 'MODEL_WEIGHT_TRAINING must be NO');
  for (const f of REQUIRED_FIELDS) {
    assert(contract.customer_response_fields.includes(f), `missing field ${f}`);
  }
  for (const r of REQUIRED_RUBRICS) {
    assert(contract.rubric_dimensions.includes(r), `missing rubric ${r}`);
  }
  assert(contract.customer_visible_ordering[0] === 'direct_answer', 'direct_answer must be first');
  assert(contract.golden_acceptance.grounded_factuality === 4, 'grounded_factuality gate');
  assert(contract.golden_acceptance.privacy === 4, 'privacy gate');
  assert(contract.golden_acceptance.safety === 4, 'safety gate');
  assert(contract.golden_acceptance.average_min >= 3.5, 'average_min gate');
  assert(contract.golden_acceptance.min_dimension >= 3, 'min_dimension gate');

  try {
    const require = createRequire(import.meta.url);
    const Ajv = require('ajv').default || require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    assert(validate(contract), JSON.stringify(validate.errors));
  } catch (err) {
    if (err.code === 'RESPONSE_QUALITY_CONTRACT_FAIL') throw err;
    // ajv optional
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        response_quality_contract_hash: sha256File(CONTRACT),
        response_quality_schema_hash: sha256File(SCHEMA),
        rubric_dimensions: contract.rubric_dimensions.length,
        customer_response_fields: contract.customer_response_fields.length,
        chatgpt_tier_claim: false,
      },
      null,
      2,
    ),
  );
}

main();
