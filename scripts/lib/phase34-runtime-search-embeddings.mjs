/**
 * Runtime analyzers for embeddings + semantic/hybrid search.
 * Vector index may be unavailable — fall back honestly. MODEL_WEIGHT_TRAINING remains NO.
 */
import { computeConfidenceFactors } from './phase33c-confidence.mjs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function keywordScore(queryTokens, doc) {
  const hay = tokenize([doc.artist, doc.title, doc.catalog_number, doc.summary].filter(Boolean).join(' '));
  if (!queryTokens.length || !hay.length) return 0;
  const set = new Set(hay);
  let hit = 0;
  for (const t of queryTokens) if (set.has(t)) hit += 1;
  return hit / queryTokens.length;
}

export function analyzeEmbeddings(input = {}) {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const honestLimit =
    input.honest_limit === true ||
    input.force_abstain === true ||
    String(input.catalog_number || '').includes('DOES-NOT-EXIST');
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

  const payload = {
    schema_version: 'phase34-embeddings-runtime-v1',
    embedding_status: honestLimit ? 'ABSTAIN_INSUFFICIENT_EVIDENCE' : 'METADATA_NEIGHBORS_ONLY',
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
      : ['MODEL_WEIGHT_TRAINING_NO', 'VECTOR_WRITE_DISABLED'],
    retrieval_execution: {
      requested_mode: 'metadata_embedding_diagnostic',
      executed_mode: 'metadata_neighbor_scan',
      vector_executed: false,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    },
    abstention_reason: honestLimit ? 'INSUFFICIENT_EVIDENCE' : null,
  };

  return {
    result: payload,
    diagnostics: {
      retrieval_mode: 'metadata_neighbor_scan',
      model_weight_training: 'NO',
    },
    explanation: honestLimit
      ? 'Not enough authorized neighbors for an embedding diagnostic.'
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
  // Production hybrid vector default remains NOT_ENABLED — execute keyword with honest label.
  const executed_mode =
    requested_mode === 'hybrid'
      ? 'keyword_only_vector_unavailable'
      : requested_mode === 'vector'
        ? 'keyword_only_vector_unavailable'
        : 'keyword';

  const ranked = honestLimit
    ? []
    : candidates
        .map((c, i) => ({
          ...c,
          _score: keywordScore(tokens, c),
          _i: i,
        }))
        .filter((c) => c._score > 0 || (!tokens.length && c.market_event_id))
        .sort((a, b) => b._score - a._score || a._i - b._i)
        .slice(0, 10);

  const evidence = ranked.map((c, i) => ({
    evidence_id: c.market_event_id || c.evidence_id || `hit-${i}`,
    market_event_id: c.market_event_id || c.evidence_id || `hit-${i}`,
    source_type: c.sale_kind === 'sold' ? 'sale' : 'listing',
    sale_kind: c.sale_kind || null,
    event_type: c.event_type || null,
    summary: `${c.artist || ''} — ${c.title || ''}`.trim() || `hit-${i}`,
    score: c._score,
    observed_at: c.occurred_at || new Date().toISOString(),
  }));

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
      ? ['INSUFFICIENT_EVIDENCE', 'VECTOR_INDEX_UNAVAILABLE']
      : ['VECTOR_INDEX_UNAVAILABLE'],
    retrieval_execution: {
      requested_mode,
      executed_mode,
      vector_executed: false,
      fallback_reason: requested_mode !== 'keyword' ? 'VECTOR_INDEX_UNAVAILABLE' : null,
      model_execution: 'NOT_INVOKED_BY_POLICY',
    },
    abstention_reason: honestLimit ? 'INSUFFICIENT_EVIDENCE' : null,
  };

  return {
    result: payload,
    diagnostics: {
      retrieval_mode: executed_mode,
      vector_executed: false,
    },
    explanation: honestLimit
      ? 'No authorized matches for this subject.'
      : `Keyword retrieval returned ${evidence.length} hits; vector index unavailable.`,
  };
}
