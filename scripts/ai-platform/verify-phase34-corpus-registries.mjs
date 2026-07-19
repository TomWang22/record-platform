#!/usr/bin/env node
/**
 * Verify Phase 34 corpus registries.
 * Fine-tuning remains DISABLED; no auto-copy from retrieval.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RETRIEVAL = path.join(__dirname, 'phase34-retrieval-corpus-registry.json');
const EVALUATION = path.join(__dirname, 'phase34-evaluation-corpus-registry.json');
const FINETUNE = path.join(__dirname, 'phase34-finetuning-corpus-registry.json');

const RETRIEVAL_PERMITTED = [
  'first_party_authorized_market_facts',
  'discogs_cc0_catalog_metadata',
  'licensed_historical_sales_records',
  'first_party_knowledge_articles',
  'user_authorized_current_thread_context',
];

const FINETUNE_REQUIRED_FUTURE_FIELDS = [
  'rights_approval',
  'consent_status',
  'privacy_review',
  'license',
  'source_lineage',
  'deduplication',
  'train_validation_holdout_assignment',
  'deletion_propagation_policy',
  'reproducible_dataset_hash',
  'model_target',
  'rollback_plan',
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'CORPUS_REGISTRY_FAIL';
    throw err;
  }
}

function load(p) {
  assert(fs.existsSync(p), `missing ${path.basename(p)}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const retrieval = load(RETRIEVAL);
  const evaluation = load(EVALUATION);
  const finetune = load(FINETUNE);

  assert(finetune.status === 'DISABLED', 'finetuning corpus must be DISABLED');
  assert(finetune.auto_copy_from_retrieval === false, 'no auto-copy from retrieval to finetune');
  assert(retrieval.auto_copy_to_finetuning === false, 'retrieval must not auto-copy to finetune');
  assert(evaluation.auto_copy_to_finetuning === false, 'evaluation must not auto-copy to finetune');

  for (const cls of RETRIEVAL_PERMITTED) {
    assert(
      retrieval.permitted_source_classes.includes(cls),
      `retrieval missing permitted class ${cls}`,
    );
  }
  for (const cls of retrieval.permitted_source_classes) {
    assert(RETRIEVAL_PERMITTED.includes(cls), `retrieval has non-permitted class ${cls}`);
  }

  for (const field of FINETUNE_REQUIRED_FUTURE_FIELDS) {
    assert(
      finetune.required_future_fields.includes(field),
      `finetune missing required future field ${field}`,
    );
  }
  assert(
    Array.isArray(finetune.entries) && finetune.entries.length === 0,
    'finetune entries must be empty while DISABLED',
  );

  // No entry may claim it was auto-copied from retrieval into finetune.
  for (const entry of finetune.entries || []) {
    assert(!entry?.copied_from_retrieval, 'finetune entry must not be copied from retrieval');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        retrieval_corpus_registry_hash: sha256File(RETRIEVAL),
        evaluation_corpus_registry_hash: sha256File(EVALUATION),
        finetuning_corpus_registry_hash: sha256File(FINETUNE),
        finetuning_status: finetune.status,
        auto_copy_from_retrieval: false,
        model_weight_training: 'NO',
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
        code: err.code || 'CORPUS_REGISTRY_FAIL',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
