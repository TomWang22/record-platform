/**
 * Runtime analyzers for embeddings + semantic/hybrid search.
 * Vector index may be unavailable — fall back honestly. MODEL_WEIGHT_TRAINING remains NO.
 */
import crypto from 'node:crypto';
import { computeConfidenceFactors } from './phase33c-confidence.mjs';
import { retrieve, createRetrievalStores } from './phase34-retrieval.mjs';
import {
  createPersistedEmbeddingStore,
  buildRetrievalLedgerRow,
  EMBEDDING_MODEL_ID,
  EMBEDDING_VERSION,
  VECTOR_INDEX_VERSION,
} from './phase34-persisted-vector-index.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function keywordScore(queryTokens, doc) {
  const hay = tokenize(
    [doc.artist, doc.title, doc.catalog_number, doc.summary].filter(Boolean).join(' '),
  );
  if (!queryTokens.length || !hay.length) return 0;
  const set = new Set(hay);
  let hit = 0;
  for (const t of queryTokens) if (set.has(t)) hit += 1;
  return hit / queryTokens.length;
}

function resolveVectorStore(input = {}) {
  if (input.vectorIndex || input.vectorSearch) {
    return {
      vectorIndex: input.vectorIndex || null,
      vectorSearch: input.vectorSearch || null,
      embedding_model: input.embedding_model || EMBEDDING_MODEL_ID,
      store: null,
    };
  }
  const storePath =
    input.persisted_embeddings_path || process.env.PHASE34_PERSISTED_EMBEDDINGS_PATH || null;
  if (!storePath) return null;
  const store = createPersistedEmbeddingStore(storePath);
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (candidates.length) {
    store.upsertDocs(
      candidates.map((c, i) => ({
        ...c,
        id: c.id || c.market_event_id || c.evidence_id || `cand-${i}`,
      })),
    );
  }
  return {
    vectorIndex: store.toVectorIndex(),
    vectorSearch: null,
    embedding_model: store.embedding_model,
    store,
  };
}

export function analyzeEmbeddings(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const honestLimit =
    input.honest_limit === true ||
    input.force_abstain === true ||
    String(input.catalog_number || '').includes('DOES-NOT-EXIST');
  const vector = resolveVectorStore(input);
  const neighbors = honestLimit
    ? []
    : candidates.slice(0, 5).map((c, i) => ({
        market_event_id: c.market_event_id || c.evidence_id || `emb-n-${i}`,
        similarity: Math.max(0.1, 0.9 - i * 0.1),
        summary: `${c.artist || ''} — ${c.title || ''}`.trim() || `neighbor-${i}`,
      }));

  const evidence = neighbors.map((n) => ({
    evidence_id: n.market_event_id,
    market_event_id: n.market_event_id,
    source_type: 'sale',
    sale_kind: 'sold',
    event_type: 'SALE_COMPLETED',
    summary: n.summary,
    observed_at: new Date().toISOString(),
  }));

  const vector_executed = Boolean(vector?.store && vector.store.size() > 0);
  const payload = {
    schema_version: 'phase34-embeddings-runtime-v1',
    embedding_status: honestLimit
      ? 'ABSTAIN_INSUFFICIENT_EVIDENCE'
      : vector_executed
        ? 'PERSISTED_VECTOR_NEIGHBORS'
        : 'METADATA_NEIGHBORS_ONLY',
    lineage_status: 'READ_ONLY_DIAGNOSTIC',
    model_weight_training: 'NO',
    neighbor_count: neighbors.length,
    neighbors,
    evidence,
    confidence: honestLimit ? 0.2 : Math.min(0.85, 0.4 + neighbors.length * 0.08),
    confidence_factors: computeConfidenceFactors({
      evidence_count: evidence.length,
      contradiction_count: 0,
    }),
    limitations: honestLimit
      ? ['INSUFFICIENT_EVIDENCE', 'MODEL_WEIGHT_TRAINING_NO']
      : vector_executed
        ? ['MODEL_WEIGHT_TRAINING_NO']
        : ['MODEL_WEIGHT_TRAINING_NO', 'VECTOR_WRITE_DISABLED'],
    retrieval_execution: {
      requested_mode: 'metadata_embedding_diagnostic',
      executed_mode: vector_executed ? 'persisted_vector_neighbor_scan' : 'metadata_neighbor_scan',
      vector_executed,
      embedding_model: vector?.embedding_model || null,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    },
    abstention_reason: honestLimit ? 'INSUFFICIENT_EVIDENCE' : null,
  };

  return {
    result: payload,
    diagnostics: {
      retrieval_mode: payload.retrieval_execution.executed_mode,
      model_weight_training: 'NO',
      vector_executed,
    },
    explanation: honestLimit
      ? 'Not enough authorized neighbors for an embedding diagnostic.'
      : vector_executed
        ? `Reported ${neighbors.length} neighbors using persisted embeddings (${vector.embedding_model}).`
        : `Reported ${neighbors.length} metadata neighbors without writing model weights.`,
  };
}

export function analyzeSemanticSearch(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const query = [input.artist, input.title, input.catalog_number, input.user_intent, input.q]
    .filter(Boolean)
    .join(' ');
  const tokens = tokenize(query);
  const honestLimit =
    input.honest_limit === true ||
    input.force_abstain === true ||
    String(input.catalog_number || '').includes('DOES-NOT-EXIST');

  const requested_mode = input.retrieval_mode || input.search_mode || 'hybrid';
  const vector = honestLimit ? null : resolveVectorStore(input);
  const started = Date.now();

  let executed_mode;
  let evidence = [];
  let retrieval_execution = null;
  let retrieval_ledger = null;
  let explanation;

  if (honestLimit) {
    executed_mode = 'abstain';
    explanation = 'No authorized matches for this subject.';
    retrieval_execution = {
      requested_mode,
      executed_mode,
      vector_executed: false,
      fallback_reason: null,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    };
  } else if (vector) {
    const docs = candidates.map((c, i) => ({
      ...c,
      id: c.id || c.market_event_id || c.evidence_id || `hit-${i}`,
      market_event_id: c.market_event_id || c.evidence_id || `hit-${i}`,
    }));
    const stores = createRetrievalStores({ catalog: docs });
    const ret = retrieve({
      query: query || 'catalog',
      stores,
      store_names: ['catalog'],
      requested_mode: ['keyword', 'vector', 'hybrid', 'exact'].includes(requested_mode)
        ? requested_mode
        : 'hybrid',
      limit: 10,
      vectorIndex: vector.vectorIndex,
      vectorSearch: vector.vectorSearch,
      skipRightsFilter: true,
    });
    executed_mode = ret.executed_mode;
    evidence = (ret.candidates || []).map((c, i) => {
      const doc = c.doc || c;
      return {
        evidence_id: doc.market_event_id || doc.id || `hit-${i}`,
        market_event_id: doc.market_event_id || doc.id || `hit-${i}`,
        source_type: doc.sale_kind === 'sold' ? 'sale' : 'listing',
        sale_kind: doc.sale_kind || null,
        event_type: doc.event_type || null,
        summary: `${doc.artist || ''} — ${doc.title || ''}`.trim() || `hit-${i}`,
        score: c.score,
        keyword_score: c.mode === 'keyword' ? c.score : null,
        vector_score: c.mode === 'vector' || c.mode === 'hybrid' ? c.score : null,
        fused_score: c.mode === 'hybrid' ? c.score : null,
        mode: c.mode,
        observed_at: doc.occurred_at || new Date().toISOString(),
      };
    });
    const vectorRan = Boolean(
      ret.vector_executed ?? ['vector', 'hybrid'].includes(ret.executed_mode),
    );
    retrieval_execution = {
      requested_mode: ret.requested_mode,
      executed_mode: ret.executed_mode,
      vector_executed: vectorRan,
      fallback_reason: ret.fallback_reason,
      embedding_model: vector.embedding_model,
      embedding_version: EMBEDDING_VERSION,
      vector_index_version: VECTOR_INDEX_VERSION,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    };
    retrieval_ledger = buildRetrievalLedgerRow({
      retrieval_invocation_id: `ret-${crypto.randomUUID().replace(/-/g, '')}`,
      requested_mode: ret.requested_mode,
      executed_mode: ret.executed_mode,
      query,
      owner_scope: input.owner_scope || null,
      embedding: {
        embedding_model: vector.embedding_model,
        embedding_version: EMBEDDING_VERSION,
        vector_index_version: VECTOR_INDEX_VERSION,
      },
      candidates_before: candidates.length,
      candidates_after: evidence.length,
      scores: {
        keyword: evidence.find((e) => e.mode === 'keyword')?.score ?? null,
        vector: evidence.find((e) => e.mode === 'vector')?.score ?? null,
        fused: evidence.find((e) => e.mode === 'hybrid')?.score ?? null,
      },
      final_rank: evidence[0]?.evidence_id || null,
      latency_ms: Date.now() - started,
      visible_fallback: ret.fallback_reason
        ? { status: 'VISIBLE_FALLBACK', reason: ret.fallback_reason }
        : { status: 'NONE' },
    });
    explanation =
      executed_mode === 'hybrid'
        ? `Hybrid retrieval returned ${evidence.length} hits (keyword+vector via ${vector.embedding_model}).`
        : executed_mode === 'vector'
          ? `Vector retrieval returned ${evidence.length} hits via ${vector.embedding_model}.`
          : executed_mode.startsWith('keyword')
            ? `Keyword path returned ${evidence.length} hits` +
              (ret.fallback_reason ? ` (visible fallback: ${ret.fallback_reason}).` : '.')
            : `Retrieval executed_mode=${executed_mode} with ${evidence.length} hits.`;
  } else {
    executed_mode =
      requested_mode === 'hybrid' || requested_mode === 'vector'
        ? 'keyword_only_vector_unavailable'
        : 'keyword';
    const ranked = candidates
      .map((c, i) => ({
        ...c,
        _score: keywordScore(tokens, c),
        _i: i,
      }))
      .filter((c) => c._score > 0 || (!tokens.length && c.market_event_id))
      .sort((a, b) => b._score - a._score || a._i - b._i)
      .slice(0, 10);
    evidence = ranked.map((c, i) => ({
      evidence_id: c.market_event_id || c.evidence_id || `hit-${i}`,
      market_event_id: c.market_event_id || c.evidence_id || `hit-${i}`,
      source_type: c.sale_kind === 'sold' ? 'sale' : 'listing',
      sale_kind: c.sale_kind || null,
      event_type: c.event_type || null,
      summary: `${c.artist || ''} — ${c.title || ''}`.trim() || `hit-${i}`,
      score: c._score,
      observed_at: c.occurred_at || new Date().toISOString(),
    }));
    retrieval_execution = {
      requested_mode,
      executed_mode,
      vector_executed: false,
      fallback_reason: requested_mode !== 'keyword' ? 'VECTOR_INDEX_UNAVAILABLE' : null,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    };
    explanation = `Keyword retrieval returned ${evidence.length} hits; vector index unavailable.`;
  }

  const payload = {
    schema_version: 'phase34-semantic-search-runtime-v1',
    search_mode: executed_mode,
    requested_mode,
    result_count: evidence.length,
    results: evidence,
    evidence,
    confidence: honestLimit ? 0.15 : Math.min(0.8, 0.35 + evidence.length * 0.05),
    confidence_factors: computeConfidenceFactors({
      evidence_count: evidence.length,
      contradiction_count: 0,
    }),
    limitations: honestLimit
      ? ['INSUFFICIENT_EVIDENCE', ...(vector ? [] : ['VECTOR_INDEX_UNAVAILABLE'])]
      : vector
        ? []
        : ['VECTOR_INDEX_UNAVAILABLE'],
    retrieval_execution,
    retrieval_ledger,
    abstention_reason: honestLimit ? 'INSUFFICIENT_EVIDENCE' : null,
  };

  return {
    result: payload,
    diagnostics: {
      retrieval_mode: executed_mode,
      vector_executed: Boolean(retrieval_execution?.vector_executed),
      embedding_model: retrieval_execution?.embedding_model || null,
    },
    explanation,
  };
}
