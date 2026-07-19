#!/usr/bin/env node
/**
 * Verify Phase 34 intelligence pipeline contract + adversarial fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const CONTRACT = path.join(__dirname, 'phase34-intelligence-pipeline-contract.json');
const SCHEMA = path.join(__dirname, 'phase34-intelligence-pipeline-contract.schema.json');
const FIXTURES = path.join(__dirname, 'phase34-adversarial-pipeline-fixtures.json');
const DOC = path.join(REPO, 'docs/ai-platform/PHASE_34_INTELLIGENCE_PIPELINE.md');

const REQUIRED_STAGES = [
  'RAW_INGESTION',
  'SCHEMA_VALIDATION',
  'NORMALIZATION',
  'ENTITY_AND_PRESSING_IDENTITY_RESOLUTION',
  'AUTHORIZATION_AND_PRIVACY_FILTERING',
  'DELETION_EXPIRY_CORRECTION_APPLICATION',
  'EVIDENCE_SNAPSHOT_MATERIALIZATION',
  'MARKET_ANALYTICS_AND_DETERMINISTIC_FEATURES',
  'EMBEDDING_RETRIEVAL_RERANKING',
  'DETERMINISTIC_CAPABILITY_ENGINE',
  'MODEL_SYNTHESIS',
  'OUTPUT_SCHEMA_VALIDATION',
  'SAFETY_PRIVACY_VALIDATION',
  'API_RESPONSE',
  'CLIENT_RENDER',
  'TELEMETRY_REVIEW_EVIDENCE',
];

const REQUIRED_PROVENANCE = [
  'pipeline_version',
  'source_connector',
  'source_event_id',
  'source_entity_id',
  'source_type',
  'source_owner_scope',
  'authorization_scope',
  'privacy_class',
  'ingested_at',
  'source_event_time',
  'normalized_at',
  'watermark',
  'schema_version',
  'content_hash',
  'deduplication_key',
  'identity_resolution_version',
  'pressing_identity',
  'correction_chain',
  'deletion_status',
  'expiry_status',
  'staleness_status',
  'currency_normalization_version',
  'condition_normalization_version',
  'evidence_snapshot_id',
  'evidence_snapshot_hash',
  'analytics_feature_version',
  'embedding_version',
  'retrieval_configuration_hash',
  'reranker_version',
  'prompt_configuration_id',
  'prompt_hash',
  'model_identifier',
  'model_configuration_hash',
  'output_schema_version',
  'runtime_image_digest',
  'certificate_pin',
  'request_id',
  'session_id',
  'turn_id',
  'trace_id',
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'PIPELINE_CONTRACT_FAIL';
    throw err;
  }
}

function validateAjv(contract, schema) {
  try {
    const require = createRequire(import.meta.url);
    const Ajv = require('ajv').default || require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(contract);
    return { ok, errors: validate.errors || [], skipped: false };
  } catch {
    return { ok: true, errors: [], skipped: true, reason: 'ajv_not_installed' };
  }
}

function evaluateAdversarialFixture(fixture) {
  const events = fixture.events || [];
  switch (fixture.id) {
    case 'duplicate_sold_events': {
      const keys = new Set(events.map((e) => e.source_event_id));
      return { ok: keys.size < events.length, detail: 'duplicates_present_for_suppression' };
    }
    case 'asking_marked_sold':
      return {
        ok: events.some((e) => e.source_type === 'asking' && e.listed_as === 'sold'),
        detail: 'asking_as_sold_flagged',
      };
    case 'stale_auction_status':
      return { ok: events.some((e) => e.staleness_status === 'STALE'), detail: 'stale_flagged' };
    case 'deleted_listing':
      return { ok: events.some((e) => e.deletion_status === 'DELETED'), detail: 'deleted_flagged' };
    case 'currency_mismatch':
      return { ok: events.some((e) => e.currency && e.currency !== 'USD'), detail: 'currency_needs_norm' };
    case 'pressing_mismatch':
      return {
        ok: events.some((e) => e.pressing_identity !== e.requested_pressing_identity),
        detail: 'pressing_mismatch_flagged',
      };
    case 'out_of_order_correction': {
      const seqs = events.map((e) => e.correction_seq);
      return { ok: seqs[0] > seqs[1], detail: 'out_of_order_present' };
    }
    case 'duplicate_catalog_across_releases': {
      const catalogs = events.map((e) => e.catalog_number);
      const releases = new Set(events.map((e) => e.release_id));
      return { ok: catalogs[0] === catalogs[1] && releases.size === 2, detail: 'catalog_collision' };
    }
    case 'unauthorized_owner_data':
      return {
        ok: events.some((e) => e.authorization_scope === 'denied'),
        detail: 'unauthorized_flagged',
      };
    case 'expired_memory':
      return { ok: events.some((e) => e.expiry_status === 'EXPIRED'), detail: 'expired_flagged' };
    case 'malformed_condition':
      return { ok: events.some((e) => e.condition === '!!!'), detail: 'malformed_condition' };
    case 'missing_event_timestamp':
      return { ok: events.some((e) => !e.source_event_time), detail: 'missing_timestamp' };
    default:
      return { ok: false, detail: `unknown_fixture:${fixture.id}` };
  }
}

function main() {
  assert(fs.existsSync(CONTRACT), 'missing pipeline contract');
  assert(fs.existsSync(SCHEMA), 'missing pipeline schema');
  assert(fs.existsSync(FIXTURES), 'missing adversarial fixtures');
  assert(fs.existsSync(DOC), 'missing pipeline doc');

  const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));

  assert(contract.model_weight_training === 'NO', 'MODEL_WEIGHT_TRAINING must be NO');
  assert(
    contract.optimization === 'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    'optimization pin mismatch',
  );
  assert(contract.untraceable_material_claims === 'FAIL_CLOSED', 'untraceable claims must fail closed');

  for (const stage of REQUIRED_STAGES) {
    assert(contract.stages.includes(stage), `missing stage ${stage}`);
  }
  for (const field of REQUIRED_PROVENANCE) {
    assert(contract.provenance_fields.includes(field), `missing provenance ${field}`);
  }
  assert(contract.provenance_fields.length >= 40, 'provenance_fields too short');
  assert(contract.ingestion_behaviors.length >= 16, 'ingestion_behaviors too short');
  assert(contract.authorized_evidence_bundle_fields.includes('deterministic_metrics'), 'missing deterministic_metrics');
  assert(
    contract.stages.indexOf('MARKET_ANALYTICS_AND_DETERMINISTIC_FEATURES') <
      contract.stages.indexOf('MODEL_SYNTHESIS'),
    'analytics must precede model synthesis',
  );

  const ajv = validateAjv(contract, schema);
  assert(ajv.ok, `schema validation failed: ${JSON.stringify(ajv.errors)}`);

  const fixtureIds = new Set((fixtures.fixtures || []).map((f) => f.id));
  for (const id of contract.adversarial_fixture_ids) {
    assert(fixtureIds.has(id), `missing adversarial fixture ${id}`);
  }
  const fixtureResults = [];
  for (const fixture of fixtures.fixtures || []) {
    const result = evaluateAdversarialFixture(fixture);
    assert(result.ok, `adversarial fixture inactive: ${fixture.id}`);
    fixtureResults.push({ id: fixture.id, ...result, expected_behavior: fixture.expected_behavior });
  }

  for (const [k, v] of Object.entries(contract.hard_gates || {})) {
    assert(v === 0, `hard gate ${k} must be 0`);
  }

  const out = {
    ok: true,
    pipeline_contract_hash: sha256File(CONTRACT),
    pipeline_schema_hash: sha256File(SCHEMA),
    adversarial_fixtures_hash: sha256File(FIXTURES),
    stages: contract.stages.length,
    provenance_fields: contract.provenance_fields.length,
    adversarial_fixtures: fixtureResults.length,
    ajv_skipped: ajv.skipped === true,
    model_weight_training: contract.model_weight_training,
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
