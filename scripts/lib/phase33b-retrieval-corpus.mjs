/**
 * Phase 33B retrieval corpus validator (offline).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_TRAINING_PATTERNS,
  PRIVATE_FIELD_PATTERNS,
} from './phase33a-intelligence-capability-contracts.mjs';
import {
  AUTHORIZATION_SCOPES,
  PRIVACY_CLASSES,
  validatePhase33bDataLineage,
} from './phase33b-data-lineage.mjs';

const CONTENT_HASH_RE = /^sha256:[a-f0-9]{64}$/;
const DELETION_STATES = ['ACTIVE', 'STALE', 'REEMBED_REQUIRED', 'DELETE_PENDING', 'DELETED'];
const RELEVANCE_GRADES = new Set([-1, 0, 1, 2, 3]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function scanText(text, violations, where) {
  for (const re of PRIVATE_FIELD_PATTERNS) {
    if (re.test(text)) violations.push(`private_field_fixture:${where}`);
  }
  const stripped = text
    .replace(/embedding generation is not model training/gi, '')
    .replace(/not model training/gi, '')
    .replace(/is not foundation-model training/gi, '');
  for (const re of FORBIDDEN_TRAINING_PATTERNS) {
    if (re.test(stripped)) violations.push(`unsupported_training_claim:${where}`);
  }
  if (/(^|[^a-z])\/tmp\//.test(text) && !where.includes('report')) {
    if (!text.includes('"note": "tmp evidence')) {
      // allow historical notes in matrix docs only; corpus must not depend on /tmp
      if (where.includes('retrieval-corpus') || where.includes('data-source') || where.includes('policy')) {
        violations.push(`tmp_dependency_in_committed_input:${where}`);
      }
    }
  }
}

export function loadCorpus(packageRoot) {
  const root = path.join(packageRoot, 'retrieval-corpus');
  return {
    root,
    manifest: readJson(path.join(root, 'corpus-manifest.json')),
    queries: readJson(path.join(root, 'queries.json')).queries,
    documents: readJson(path.join(root, 'documents.json')).documents,
    judgments: readJson(path.join(root, 'relevance-judgments.json')).judgments,
    hardNegatives: readJson(path.join(root, 'hard-negatives.json')).hard_negatives,
    embeddings: readJson(path.join(root, 'embedding-fixture-records.json')).records,
    negotiation: readJson(path.join(root, 'negotiation-thread-fixtures.json')).fixtures,
    auctions: readJson(path.join(root, 'auction-watchlist-fixtures.json')).batches,
  };
}

export function validatePhase33bRetrievalCorpus(repoRoot, options = {}) {
  const packageRoot = options.packageRoot || path.join(repoRoot, 'scripts/ai-platform');
  const violations = [];
  const diagnostics = [];
  const policyPath = path.join(packageRoot, 'retrieval-acceptance-policy.json');
  const lineageReport = validatePhase33bDataLineage(repoRoot, { packageRoot });
  if (lineageReport.status !== 'PASS') {
    violations.push(...lineageReport.violations.map((v) => `lineage:${v}`));
  }

  let corpus;
  try {
    corpus = loadCorpus(packageRoot);
  } catch (err) {
    return {
      status: 'FAIL',
      violations: [`corpus_load_error:${err.message}`],
      diagnostics: [],
    };
  }

  for (const file of fs.readdirSync(corpus.root)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(corpus.root, file);
    scanText(fs.readFileSync(full, 'utf8'), violations, `retrieval-corpus/${file}`);
  }
  scanText(fs.readFileSync(policyPath, 'utf8'), violations, 'retrieval-acceptance-policy.json');

  const queryIds = new Set();
  for (const q of corpus.queries) {
    if (queryIds.has(q.query_id)) violations.push(`duplicate_query_id:${q.query_id}`);
    queryIds.add(q.query_id);
    for (const s of q.authorized_scopes || []) {
      if (!AUTHORIZATION_SCOPES.includes(s)) violations.push(`invalid_query_scope:${q.query_id}:${s}`);
    }
    if (!q.requesting_principal_fixture) violations.push(`missing_principal:${q.query_id}`);
    if (!q.query_class) violations.push(`missing_query_class:${q.query_id}`);
  }

  const docIds = new Set();
  for (const d of corpus.documents) {
    if (docIds.has(d.document_id)) violations.push(`duplicate_document_id:${d.document_id}`);
    docIds.add(d.document_id);
    if (!PRIVACY_CLASSES.includes(d.privacy_class)) {
      violations.push(`invalid_doc_privacy:${d.document_id}:${d.privacy_class}`);
    }
    if (!AUTHORIZATION_SCOPES.includes(d.authorization_scope)) {
      violations.push(`invalid_doc_scope:${d.document_id}:${d.authorization_scope}`);
    }
    if (!DELETION_STATES.includes(d.deletion_state) && d.deletion_state !== 'ACTIVE') {
      // documents use ACTIVE/DELETED primarily; allow ACTIVE even if not in embedding enum path
      if (!['ACTIVE', 'DELETED', 'STALE', 'DELETE_PENDING', 'REEMBED_REQUIRED'].includes(d.deletion_state)) {
        violations.push(`invalid_deletion_state:${d.document_id}:${d.deletion_state}`);
      }
    }
  }

  for (const j of corpus.judgments) {
    if (!queryIds.has(j.query_id)) violations.push(`missing_judgment_query_ref:${j.query_id}`);
    if (!docIds.has(j.document_id)) violations.push(`missing_judgment_document_ref:${j.document_id}`);
    if (!RELEVANCE_GRADES.has(Number(j.relevance_grade))) {
      violations.push(`invalid_relevance_grade:${j.query_id}:${j.document_id}:${j.relevance_grade}`);
    }
  }

  for (const h of corpus.hardNegatives) {
    if (!queryIds.has(h.query_id) || !docIds.has(h.document_id)) {
      violations.push(`hard_negative_missing_ref:${h.query_id}:${h.document_id}`);
    }
    if (h.exact_pressing_match === true || h.exact_release_match === true) {
      violations.push(`hard_negative_marked_exact_match:${h.query_id}:${h.document_id}`);
    }
    const j = corpus.judgments.find(
      (x) => x.query_id === h.query_id && x.document_id === h.document_id,
    );
    if (j && Number(j.relevance_grade) >= 2) {
      violations.push(`hard_negative_high_relevance:${h.query_id}:${h.document_id}`);
    }
  }

  // Privacy judgment sanity
  for (const j of corpus.judgments) {
    if (Number(j.relevance_grade) === -1 && j.authorized === true) {
      // prohibited may be labeled authorized:false preferred
      const doc = corpus.documents.find((d) => d.document_id === j.document_id);
      if (doc && (doc.privacy_class === 'OWNER_PRIVATE' || doc.privacy_class === 'THREAD_PRIVATE')) {
        violations.push(`private_result_marked_authorized:${j.query_id}:${j.document_id}`);
      }
    }
  }

  for (const emb of corpus.embeddings) {
    for (const field of [
      'embedding_id',
      'model_id',
      'model_version',
      'dimension',
      'normalization',
      'chunking_strategy',
      'chunking_version',
      'content_hash',
      'source_id',
      'source_entity_id',
      'source_version',
      'privacy_class',
      'authorization_scope',
      'created_at',
      'source_updated_at',
      'deletion_state',
      'lineage',
    ]) {
      if (emb[field] === undefined || emb[field] === null || emb[field] === '') {
        if (field === 'reembedding_reason') continue;
        violations.push(`missing_embedding_field:${emb.embedding_id || '?'}:${field}`);
      }
    }
    if (!CONTENT_HASH_RE.test(emb.content_hash || '')) {
      violations.push(`invalid_content_hash:${emb.embedding_id}`);
    }
    if (!Number.isInteger(emb.dimension) || emb.dimension < 1 || emb.dimension > 16) {
      // fixture vectors intentionally tiny
      if (!Number.isInteger(emb.dimension) || emb.dimension < 1) {
        violations.push(`invalid_embedding_dimension:${emb.embedding_id}`);
      }
    }
    if (!emb.source_version) violations.push(`missing_source_version:${emb.embedding_id}`);
    if (!AUTHORIZATION_SCOPES.includes(emb.authorization_scope)) {
      violations.push(`missing_authorization_scope:${emb.embedding_id}`);
    }
    if (!DELETION_STATES.includes(emb.deletion_state)) {
      violations.push(`invalid_embedding_deletion_state:${emb.embedding_id}`);
    }
  }

  const policy = readJson(policyPath);
  const band = policy.corpus_bands.development;
  if (corpus.queries.length < band.queries_min) {
    violations.push(`corpus_queries_below_band:${corpus.queries.length}<${band.queries_min}`);
  }
  if (corpus.documents.length < band.documents_min) {
    violations.push(`corpus_documents_below_band:${corpus.documents.length}<${band.documents_min}`);
  }
  if (corpus.judgments.length < band.judgments_min) {
    violations.push(`corpus_judgments_below_band:${corpus.judgments.length}<${band.judgments_min}`);
  }

  // Every query has at least one judgment / expected behavior
  for (const q of corpus.queries) {
    const has = corpus.judgments.some((j) => j.query_id === q.query_id);
    if (!has && !q.expect_abstention) violations.push(`query_missing_expected_behavior:${q.query_id}`);
  }

  // Privacy queries must include prohibited candidates
  for (const q of corpus.queries.filter((x) => x.query_class === 'privacy_isolation')) {
    const hasProhibited = corpus.judgments.some(
      (j) => j.query_id === q.query_id && Number(j.relevance_grade) === -1,
    );
    if (!hasProhibited) violations.push(`privacy_query_missing_prohibited_candidate:${q.query_id}`);
  }

  if (policy.production_hard_stops.PERCENT !== 0) violations.push('PERCENT_nonzero');
  if (policy.production_hard_stops.ALLOW_PROD_PERCENT !== 0) {
    violations.push('ALLOW_PROD_PERCENT_nonzero');
  }

  diagnostics.push(
    `queries=${corpus.queries.length}`,
    `documents=${corpus.documents.length}`,
    `judgments=${corpus.judgments.length}`,
    `hard_negatives=${corpus.hardNegatives.length}`,
  );

  return {
    status: violations.length ? 'FAIL' : 'PASS',
    violations,
    diagnostics,
    counts: {
      queries: corpus.queries.length,
      documents: corpus.documents.length,
      judgments: corpus.judgments.length,
      hard_negatives: corpus.hardNegatives.length,
      embedding_records: corpus.embeddings.length,
      negotiation_fixtures: corpus.negotiation.length,
      auction_batches: corpus.auctions.length,
      query_classes: new Set(corpus.queries.map((q) => q.query_class)).size,
    },
  };
}
