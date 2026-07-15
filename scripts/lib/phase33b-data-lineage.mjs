/**
 * Phase 33B data-source lineage validator (offline).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_TRAINING_PATTERNS,
  PRIVATE_FIELD_PATTERNS,
} from './phase33a-intelligence-capability-contracts.mjs';

export const PRIVACY_CLASSES = [
  'PUBLIC',
  'MARKETPLACE_SHARED',
  'OWNER_PRIVATE',
  'THREAD_PRIVATE',
  'DERIVED_PRIVATE',
  'SENSITIVE',
  'PROHIBITED',
];

export const AUTHORIZATION_SCOPES = [
  'public_market',
  'authenticated_market',
  'owner_inventory',
  'owner_collection',
  'owner_watchlist',
  'authorized_thread',
  'authorized_session_memory',
];

export const REQUIRED_SOURCE_FIELDS = [
  'source_id',
  'display_name',
  'owning_service',
  'entity_types',
  'fields_used',
  'privacy_class',
  'authorization_scope',
  'freshness_expectation',
  'retention_policy',
  'deletion_source',
  'deletion_propagation',
  'embedding_allowed',
  'retrieval_allowed',
  'cross_user_allowed',
  'production_status',
  'known_gaps',
];

export const REQUIRED_INVENTORY_SOURCE_IDS = [
  'src_record_release_metadata',
  'src_pressing_variant_metadata',
  'src_active_listings',
  'src_historical_sold_listings',
  'src_auction_lots',
  'src_auction_bid_aggregates',
  'src_watchlists',
  'src_seller_inventory',
  'src_collection_data',
  'src_price_history',
  'src_marketplace_analytics',
  'src_public_profile',
  'src_private_profile_preferences',
  'src_message_threads',
  'src_prior_intelligence_summaries',
  'src_external_evidence',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function scanPrivate(text, violations, where) {
  for (const re of PRIVATE_FIELD_PATTERNS) {
    if (re.test(text)) violations.push(`private_field_fixture:${where}`);
  }
}

function scanTraining(text, violations, where) {
  // Strip policy / allowed terminology blocks similar to 33A
  const stripped = text
    .replace(/"training_terminology_policy"[\s\S]*?\n\s*\},/g, '')
    .replace(/embedding generation is not model training/gi, '')
    .replace(/not model training/gi, '')
    .replace(/is not foundation-model training/gi, '');
  for (const re of FORBIDDEN_TRAINING_PATTERNS) {
    if (re.test(stripped)) violations.push(`unsupported_training_claim:${where}`);
  }
}

export function validatePhase33bDataLineage(repoRoot, options = {}) {
  const packageRoot = options.packageRoot || path.join(repoRoot, 'scripts/ai-platform');
  const lineagePath = path.join(packageRoot, 'data-source-lineage.json');
  const policyPath = path.join(packageRoot, 'retrieval-acceptance-policy.json');
  const violations = [];
  const diagnostics = [];

  if (!fs.existsSync(lineagePath)) {
    return {
      status: 'FAIL',
      violations: ['missing_data_source_lineage'],
      diagnostics: ['data-source-lineage.json missing'],
    };
  }
  if (!fs.existsSync(policyPath)) {
    violations.push('missing_retrieval_acceptance_policy');
  }

  let lineage;
  try {
    lineage = readJson(lineagePath);
  } catch (err) {
    return {
      status: 'FAIL',
      violations: [`json_parse_error:data-source-lineage.json:${err.message}`],
      diagnostics: [],
    };
  }

  const raw = fs.readFileSync(lineagePath, 'utf8');
  scanPrivate(raw, violations, 'data-source-lineage.json');
  scanTraining(raw, violations, 'data-source-lineage.json');
  if (raw.includes('/tmp/')) {
    violations.push('tmp_path_in_committed_source:data-source-lineage.json');
  }

  const sources = Array.isArray(lineage.sources) ? lineage.sources : [];
  const ids = new Set();
  for (const src of sources) {
    for (const field of REQUIRED_SOURCE_FIELDS) {
      if (!(field in src)) violations.push(`missing_source_field:${src.source_id || '?'}:${field}`);
    }
    if (!src.source_id) {
      violations.push('missing_source_id');
      continue;
    }
    if (ids.has(src.source_id)) violations.push(`duplicate_source_id:${src.source_id}`);
    ids.add(src.source_id);
    if (!PRIVACY_CLASSES.includes(src.privacy_class)) {
      violations.push(`invalid_privacy_class:${src.source_id}:${src.privacy_class}`);
    }
    if (!AUTHORIZATION_SCOPES.includes(src.authorization_scope)) {
      violations.push(`invalid_authorization_scope:${src.source_id}:${src.authorization_scope}`);
    }
    if (!src.deletion_source) violations.push(`missing_deletion_path:${src.source_id}`);
    if (!Array.isArray(src.deletion_propagation) || src.deletion_propagation.length === 0) {
      violations.push(`missing_deletion_propagation:${src.source_id}`);
    }
    if (
      (src.privacy_class === 'OWNER_PRIVATE' || src.privacy_class === 'THREAD_PRIVATE') &&
      src.cross_user_allowed !== false
    ) {
      violations.push(`private_cross_user_source:${src.source_id}`);
    }
    if (src.privacy_class === 'PROHIBITED') {
      if (src.embedding_allowed !== false) violations.push(`prohibited_embedding_source:${src.source_id}`);
      if (src.retrieval_allowed !== false) violations.push(`prohibited_retrieval_source:${src.source_id}`);
    }
  }
  for (const required of REQUIRED_INVENTORY_SOURCE_IDS) {
    if (!ids.has(required)) violations.push(`missing_inventory_source:${required}`);
  }

  if (policyPath && fs.existsSync(policyPath)) {
    const policy = readJson(policyPath);
    const posture = policy.production_hard_stops || {};
    if (posture.default !== 'keyword') violations.push('production_default_not_keyword');
    if (posture.PERCENT !== 0) violations.push('PERCENT_nonzero');
    if (posture.ALLOW_PROD_PERCENT !== 0) violations.push('ALLOW_PROD_PERCENT_nonzero');
    if (posture.hybrid_vector_production_default !== 'NOT_ENABLED') {
      violations.push('hybrid_vector_production_default_enabled');
    }
    if (posture.production_embedding_writes !== false) {
      violations.push('production_embedding_writes_enabled');
    }
    if (posture.production_db_migration !== false) {
      violations.push('production_db_migration_enabled');
    }
  }

  const lp = lineage.production_posture || {};
  if (lp.default !== 'keyword' || lp.PERCENT !== 0 || lp.ALLOW_PROD_PERCENT !== 0) {
    violations.push('lineage_production_hard_stop_mutation');
  }

  diagnostics.push(`sources=${sources.length}`);
  return {
    status: violations.length ? 'FAIL' : 'PASS',
    violations,
    diagnostics,
    source_count: sources.length,
    privacy_classes: PRIVACY_CLASSES,
    authorization_scopes: AUTHORIZATION_SCOPES,
  };
}
