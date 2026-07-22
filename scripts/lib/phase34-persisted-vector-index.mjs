/**
 * Persisted embedding index for Phase 34 retrieval proofs.
 * MODEL_WEIGHT_TRAINING = NO. Uses a frozen, documented hash embedder
 * (not trained weights) so vector queries are real cosine searches over
 * persisted vectors — never fixture reordering labeled as hybrid.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const EMBEDDING_MODEL_ID = 'phase34-frozen-hash-embed-v1';
export const EMBEDDING_VERSION = 'phase34-embedding-v1';
export const VECTOR_INDEX_VERSION = 'phase34-vector-index-v1';
export const EMBEDDING_DIM = 64;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Frozen feature hash embedding — deterministic, no weight training.
 * Synonym expansion is explicit and versioned (not silent fixture reordering).
 */
const SYNONYM_EXPAND = Object.freeze({
  vinyl: ['record', 'lp'],
  record: ['vinyl', 'lp'],
  lp: ['vinyl', 'record'],
  auction: ['bid', 'lot'],
  bid: ['auction'],
  pressing: ['edition', 'variant'],
  edition: ['pressing', 'variant'],
});

export function expandTokens(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const syn of SYNONYM_EXPAND[t] || []) out.add(syn);
  }
  return [...out];
}

export function embedText(text, { expand = true } = {}) {
  let tokens = tokenize(text);
  if (expand) tokens = expandTokens(tokens);
  const vec = new Float64Array(EMBEDDING_DIM);
  if (!tokens.length) return Array.from(vec);
  for (const token of tokens) {
    const h = crypto.createHash('sha256').update(`${EMBEDDING_MODEL_ID}|${token}`).digest();
    for (let i = 0; i < EMBEDDING_DIM; i += 1) {
      const byte = h[i % h.length];
      vec[i] += (byte / 255) * 2 - 1;
    }
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function docText(doc) {
  return [
    doc.id,
    doc.title,
    doc.artist,
    doc.label,
    doc.pressing_id,
    doc.release_id,
    doc.summary,
    doc.body,
    doc.query,
    doc.semantic_text,
    ...(Array.isArray(doc.tags) ? doc.tags : []),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Create / load a JSONL-backed embedding store under evidence root.
 */
export function createPersistedEmbeddingStore(storePath) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  /** @type {Map<string, { id: string, vector: number[], text_hash: string, meta: object }>} */
  const byId = new Map();

  if (fs.existsSync(storePath)) {
    const raw = fs.readFileSync(storePath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      byId.set(row.id, row);
    }
  }

  function persist() {
    const lines = [...byId.values()].map((r) => JSON.stringify(r));
    fs.writeFileSync(storePath, lines.join('\n') + (lines.length ? '\n' : ''));
  }

  function upsertDocs(docs) {
    for (const doc of docs) {
      const id = String(doc.id || doc.market_event_id || doc.evidence_id);
      const text = docText(doc);
      const text_hash = crypto.createHash('sha256').update(text).digest('hex');
      const existing = byId.get(id);
      if (existing && existing.text_hash === text_hash) continue;
      byId.set(id, {
        id,
        vector: embedText(text),
        text_hash,
        embedding_model: EMBEDDING_MODEL_ID,
        embedding_version: EMBEDDING_VERSION,
        meta: {
          artist: doc.artist || null,
          title: doc.title || null,
          owner_scope: doc.owner_scope || null,
        },
      });
    }
    persist();
  }

  function search(query, docs, options = {}) {
    const limit = options.limit || 20;
    const qVec = embedText(query);
    const allowed = new Set(
      (docs || []).map((d) => String(d.id || d.market_event_id || d.evidence_id)),
    );
    const scored = [];
    for (const row of byId.values()) {
      if (allowed.size && !allowed.has(row.id)) continue;
      const doc = (docs || []).find(
        (d) => String(d.id || d.market_event_id || d.evidence_id) === row.id,
      );
      if (!doc && allowed.size) continue;
      scored.push({
        id: row.id,
        doc: doc || { id: row.id },
        score: cosine(qVec, row.vector),
        mode: 'vector',
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      results: scored.slice(0, limit),
      executed: true,
      reason: null,
      embedding_model: EMBEDDING_MODEL_ID,
      embedding_version: EMBEDDING_VERSION,
      vector_index_version: VECTOR_INDEX_VERSION,
      query_vector_dim: EMBEDDING_DIM,
      candidate_count_before_filter: byId.size,
      candidate_count_after_filter: scored.length,
    };
  }

  return {
    path: storePath,
    size: () => byId.size,
    upsertDocs,
    search,
    embedding_model: EMBEDDING_MODEL_ID,
    embedding_version: EMBEDDING_VERSION,
    vector_index_version: VECTOR_INDEX_VERSION,
    toVectorIndex() {
      return { search: (query, docs, options) => search(query, docs, options) };
    },
  };
}

/**
 * Build a retrieval ledger row required by the directive.
 */
export function buildRetrievalLedgerRow({
  retrieval_invocation_id,
  requested_mode,
  executed_mode,
  query,
  owner_scope = null,
  embedding = {},
  candidates_before = 0,
  candidates_after = 0,
  scores = {},
  final_rank = null,
  latency_ms = null,
  visible_fallback = null,
}) {
  return {
    retrieval_invocation_id,
    requested_mode,
    executed_mode,
    query_text: query,
    query_hash: crypto.createHash('sha256').update(String(query || '')).digest('hex'),
    owner_scope,
    embedding_version: embedding.embedding_version || EMBEDDING_VERSION,
    embedding_model_identifier: embedding.embedding_model || EMBEDDING_MODEL_ID,
    vector_index_version: embedding.vector_index_version || VECTOR_INDEX_VERSION,
    candidate_count_before_filtering: candidates_before,
    candidate_count_after_rights_deletion_filtering: candidates_after,
    keyword_score: scores.keyword ?? null,
    vector_score: scores.vector ?? null,
    fused_score: scores.fused ?? null,
    reranker_score: scores.reranker ?? null,
    final_rank,
    retrieval_latency_ms: latency_ms,
    visible_fallback_status: visible_fallback,
  };
}
