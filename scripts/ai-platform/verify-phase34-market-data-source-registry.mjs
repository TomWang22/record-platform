#!/usr/bin/env node
/**
 * Verify Phase 34 rights-aware market-data source registry.
 * Validates schema (Ajv when available), required fields, and enablement rules.
 * Never reads or prints actual API secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  loadRegistry,
  sha256Registry,
  enabledSources,
  disabledSources,
  assertConnectorEnablement,
  assertRequiredSourceFields,
  summarizeRestrictedPosture,
  SOURCE_REQUIRED_FIELDS,
} from '../lib/phase34-market-data-source-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(__dirname, 'phase34-market-data-source-registry.json');
const SCHEMA = path.join(__dirname, 'phase34-market-data-source-registry.schema.json');

const REQUIRED_SOURCE_IDS = [
  'fp-records',
  'fp-collections',
  'fp-seller-inventory',
  'fp-marketplace-listings',
  'fp-completed-sales',
  'fp-offers',
  'fp-auction-events',
  'fp-watchlists',
  'fp-preferences',
  'fp-authorized-message-threads',
  'fp-authorized-durable-memories',
  'fp-deletion-events',
  'fp-corrections',
  'fp-availability-changes',
  'discogs-cc0-catalog',
  'discogs-restricted-marketplace',
  'popsike-historical-auction-archive',
  'gripsweat-historical-sales-archive',
];

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'MARKET_DATA_REGISTRY_FAIL';
    throw err;
  }
}

function validateAjv(doc, schema) {
  try {
    const require = createRequire(import.meta.url);
    const Ajv = require('ajv').default || require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(doc);
    return { ok, errors: validate.errors || [], skipped: false };
  } catch {
    return { ok: true, errors: [], skipped: true, reason: 'ajv_not_installed' };
  }
}

/** Reject any accidental secret material in registry JSON text. */
function assertNoSecretLeakage(rawText) {
  const patterns = [
    { name: 'discogs_token_assignment', re: /DISCOGS_API_KEY\s*=\s*\S+/i },
    { name: 'authorization_bearer', re: /Bearer\s+[A-Za-z0-9._-]{12,}/i },
    { name: 'oauth_secret_literal', re: /"oauth_token_secret"\s*:\s*"[^"]+"/i },
  ];
  for (const p of patterns) {
    assert(!p.re.test(rawText), `secret_leakage_detected:${p.name}`);
  }
  // credentials_reference may name env:DISCOGS_API_KEY but must not embed a value
  assert(
    !/"credentials_reference"\s*:\s*"env:DISCOGS_API_KEY=.+"/i.test(rawText),
    'credentials_reference_must_not_embed_secret',
  );
}

function main() {
  assert(fs.existsSync(REGISTRY), 'missing market-data source registry');
  assert(fs.existsSync(SCHEMA), 'missing market-data source registry schema');

  const raw = fs.readFileSync(REGISTRY, 'utf8');
  assertNoSecretLeakage(raw);

  const registry = loadRegistry(REGISTRY);
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));

  assert(registry.registry_version === 'phase34-market-data-source-v1', 'registry_version mismatch');
  assert(registry.model_weight_training === 'NO', 'MODEL_WEIGHT_TRAINING must be NO');
  assert(
    registry.current_optimization ===
      'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    'current_optimization pin mismatch',
  );

  const byId = new Map();
  for (const source of registry.sources) {
    assertRequiredSourceFields(source);
    for (const f of SOURCE_REQUIRED_FIELDS) {
      assert(f in source, `missing field ${f} on ${source.source_id}`);
    }
    assert(!byId.has(source.source_id), `duplicate source_id ${source.source_id}`);
    byId.set(source.source_id, source);
    assertConnectorEnablement(source);
  }

  for (const id of REQUIRED_SOURCE_IDS) {
    assert(byId.has(id), `missing required source ${id}`);
  }

  const cc0 = byId.get('discogs-cc0-catalog');
  assert(cc0.rights_status === 'CC0', 'discogs-cc0 rights_status');
  assert(cc0.license === 'CC0', 'discogs-cc0 license');
  assert(cc0.access_method === 'DATA_DUMP', 'discogs-cc0 access_method');
  assert(cc0.connector_status === 'ENABLED', 'discogs-cc0 must be ENABLED');
  assert(cc0.retrieval_use_status === 'ALLOWED', 'discogs-cc0 retrieval');
  assert(
    cc0.model_training_status === 'NOT_AUTHORIZED_FOR_WEIGHT_TRAINING' ||
      cc0.model_training_status === 'PROHIBITED' ||
      cc0.model_training_status === 'DISABLED',
    'discogs-cc0 model training must be disabled',
  );
  assert(
    String(cc0.notes || '').includes('discogs-data-dumps.s3.us-west-2.amazonaws.com'),
    'discogs-cc0 dump URL note required',
  );

  const restricted = byId.get('discogs-restricted-marketplace');
  assert(restricted.rights_status === 'RESTRICTED', 'discogs-restricted rights');
  assert(
    restricted.connector_status === 'DISABLED_BY_POLICY' ||
      restricted.connector_status === 'DISABLED',
    'discogs-restricted must stay DISABLED*',
  );
  assert(
    restricted.credentials_reference === 'env:DISCOGS_API_KEY',
    'discogs-restricted credentials_reference must be env name only',
  );

  const popsike = byId.get('popsike-historical-auction-archive');
  assert(popsike.source_type === 'HISTORICAL_AUCTION_ARCHIVE', 'popsike source_type');
  assert(
    popsike.connector_status === 'DISABLED_PENDING_WRITTEN_PERMISSION',
    'popsike connector_status',
  );
  assert(
    popsike.rights_status === 'RESTRICTED' || popsike.rights_status === 'UNKNOWN',
    'popsike rights_status',
  );

  const gripsweat = byId.get('gripsweat-historical-sales-archive');
  assert(gripsweat.source_type === 'HISTORICAL_SALES_ARCHIVE', 'gripsweat source_type');
  assert(
    gripsweat.connector_status === 'DISABLED_PENDING_WRITTEN_PERMISSION',
    'gripsweat connector_status',
  );
  assert(
    gripsweat.rights_status === 'RESTRICTED' || gripsweat.rights_status === 'UNKNOWN',
    'gripsweat rights_status',
  );

  const ajv = validateAjv(registry, schema);
  assert(ajv.ok, `schema validation failed: ${JSON.stringify(ajv.errors)}`);

  const enabled = enabledSources(registry).map((s) => s.source_id);
  const disabled = disabledSources(registry).map((s) => s.source_id);
  const posture = summarizeRestrictedPosture(registry);

  const out = {
    ok: true,
    registry_hash: sha256Registry(REGISTRY),
    enabled_sources: enabled,
    disabled_sources: disabled,
    discogs_cc0_status: posture.discogs_cc0,
    restricted_posture: {
      discogs_restricted: posture.discogs_restricted,
      popsike: posture.popsike,
      gripsweat: posture.gripsweat,
    },
    source_count: registry.sources.length,
    ajv_skipped: ajv.skipped === true,
    model_weight_training: registry.model_weight_training,
  };
  console.log(JSON.stringify(out, null, 2));
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: String(err && err.message ? err.message : err),
        code: err && err.code ? err.code : 'MARKET_DATA_REGISTRY_FAIL',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
