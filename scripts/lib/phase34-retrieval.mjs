/**
 * Phase E2 — real retrieval interface over separated stores.
 * Modes: exact filters, keyword/BM25-ish, vector stub, hybrid combine+rerank.
 * Honesty: never label static reorder as hybrid when vector is unavailable.
 */
import crypto from 'node:crypto';

export const RETRIEVAL_VERSION = 'phase34-retrieval-v1';

export const STORE_NAMES = Object.freeze([
  'catalog',
  'listings',
  'settlements',
  'auctions',
  'bids',
  'offers',
  'watchlists',
  'collection',
  'preferences',
  'messages',
  'memory',
]);

export const REQUESTED_MODES = Object.freeze(['exact', 'keyword', 'vector', 'hybrid']);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
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
    ...(Array.isArray(doc.tags) ? doc.tags : []),
  ]
    .filter(Boolean)
    .join(' ');
}

function matchesExact(doc, filters = {}) {
  for (const [key, value] of Object.entries(filters || {})) {
    if (value == null || value === '') continue;
    if (key === 'exclude_picture_disc' && value === true) {
      const tags = (doc.tags || []).map(String);
      if (doc.picture_disc === true || tags.includes('picture_disc')) return false;
      continue;
    }
    if (key === 'min_condition') continue; // soft filter; applied elsewhere
    if (doc[key] == null) return false;
    if (String(doc[key]).toLowerCase() !== String(value).toLowerCase()) return false;
  }
  return true;
}

/**
 * Lightweight BM25-ish scoring (no global IDF corpus required).
 * Uses term frequency with length normalization; rare terms weighted via
 * inverse document frequency over the candidate pool.
 */
export function scoreBm25(queryTokens, docs) {
  const N = docs.length || 1;
  const df = new Map();
  const tokenized = docs.map((doc) => {
    const tokens = tokenize(docText(doc));
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
    return { doc, tokens, tf, len: tokens.length || 1 };
  });
  const avgdl = tokenized.reduce((s, d) => s + d.len, 0) / N;
  const k1 = 1.2;
  const b = 0.75;
  const qset = [...new Set(queryTokens)];

  return tokenized.map(({ doc, tf, len }) => {
    let score = 0;
    for (const term of qset) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgdl))));
    }
    return { doc, score };
  });
}

function vectorAvailable(options = {}) {
  return Boolean(options.vectorIndex?.search || options.vectorSearch);
}

/**
 * Stub vector search — returns empty with honest reason unless a callable index is provided.
 */
export function searchVector(query, docs, options = {}) {
  if (typeof options.vectorSearch === 'function') {
    return options.vectorSearch(query, docs, options);
  }
  if (typeof options.vectorIndex?.search === 'function') {
    return options.vectorIndex.search(query, docs, options);
  }
  return {
    results: [],
    executed: false,
    reason: 'VECTOR_INDEX_UNAVAILABLE',
  };
}

function normalizeResult(doc, score, mode, store) {
  const id = doc.id || doc.entity_id || doc.market_event_id || doc.evidence_id;
  return {
    id: String(id),
    store,
    score: Math.round(score * 10000) / 10000,
    mode,
    doc,
  };
}

function retrieveExact(storeName, docs, filters) {
  return docs
    .filter((d) => matchesExact(d, filters))
    .map((d, i) => normalizeResult(d, 1 - i * 0.001, 'exact', storeName));
}

function retrieveKeyword(storeName, docs, query, filters) {
  const filtered = docs.filter((d) => matchesExact(d, filters));
  const tokens = tokenize(query);
  if (!tokens.length) {
    return filtered.map((d, i) => normalizeResult(d, 0.1 - i * 0.001, 'keyword', storeName));
  }
  return scoreBm25(tokens, filtered)
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => normalizeResult(r.doc, r.score, 'keyword', storeName));
}

function retrieveVector(storeName, docs, query, filters, options) {
  const filtered = docs.filter((d) => matchesExact(d, filters));
  const vector = searchVector(query, filtered, options);
  if (!vector.executed && (!vector.results || vector.results.length === 0)) {
    return {
      results: [],
      executed: false,
      reason: vector.reason || 'VECTOR_INDEX_UNAVAILABLE',
    };
  }
  return {
    results: (vector.results || []).map((r, i) =>
      normalizeResult(r.doc || r, r.score ?? 1 - i * 0.01, 'vector', storeName),
    ),
    executed: true,
    reason: null,
  };
}

function rrfCombine(resultLists, k = 60) {
  const scores = new Map();
  for (const list of resultLists) {
    list.forEach((item, rank) => {
      const prev = scores.get(item.id) || { ...item, score: 0, modes: new Set() };
      prev.score += 1 / (k + rank + 1);
      prev.modes.add(item.mode);
      prev.doc = item.doc;
      prev.store = item.store;
      scores.set(item.id, prev);
    });
  }
  return [...scores.values()]
    .map((r) => {
      const modes = r.modes instanceof Set ? [...r.modes] : asArray(r.modes);
      return {
        ...r,
        modes,
        score: Math.round(r.score * 10000) / 10000,
        mode: modes.includes('vector') && modes.includes('keyword')
          ? 'hybrid'
          : modes[0] || 'hybrid',
      };
    })
    .sort((a, b) => b.score - a.score);
}

function asArray(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

/**
 * Create an empty multi-store corpus.
 */
export function createRetrievalStores(seed = {}) {
  const stores = {};
  for (const name of STORE_NAMES) {
    stores[name] = Array.isArray(seed[name]) ? [...seed[name]] : [];
  }
  return stores;
}

/**
 * Execute retrieval for a query plan against separated stores.
 *
 * @returns execution record with requested_mode, executed_mode, candidates, filters, fallback_reason
 */
export function retrieve({
  query = '',
  stores = {},
  store_names = null,
  filters = {},
  requested_mode = 'keyword',
  limit = 20,
  vectorIndex = null,
  vectorSearch = null,
} = {}) {
  const requested = REQUESTED_MODES.includes(requested_mode) ? requested_mode : 'keyword';
  const names = (store_names && store_names.length ? store_names : STORE_NAMES).filter((n) =>
    STORE_NAMES.includes(n),
  );
  const options = { vectorIndex, vectorSearch };
  const perStore = {};
  const allCandidates = [];
  let fallback_reason = null;
  let executed_mode = requested;
  let vector_ran = false;

  for (const name of names) {
    const docs = Array.isArray(stores[name]) ? stores[name] : [];
    let results = [];

    if (requested === 'exact') {
      results = retrieveExact(name, docs, filters);
      executed_mode = 'exact';
    } else if (requested === 'keyword') {
      results = retrieveKeyword(name, docs, query, filters);
      executed_mode = 'keyword';
    } else if (requested === 'vector') {
      const v = retrieveVector(name, docs, query, filters, options);
      if (!v.executed) {
        fallback_reason = v.reason || 'VECTOR_INDEX_UNAVAILABLE';
        results = retrieveKeyword(name, docs, query, filters);
        executed_mode = 'keyword_fallback_from_vector';
      } else {
        results = v.results;
        executed_mode = 'vector';
        vector_ran = true;
      }
    } else if (requested === 'hybrid') {
      const keywordHits = retrieveKeyword(name, docs, query, filters);
      const v = retrieveVector(name, docs, query, filters, options);
      if (!v.executed) {
        // Honest: keyword-only is NOT hybrid.
        fallback_reason = v.reason || 'VECTOR_INDEX_UNAVAILABLE';
        results = keywordHits.map((r) => ({
          ...r,
          mode: 'keyword',
          hybrid_attempted: true,
        }));
        executed_mode = 'keyword_only_vector_unavailable';
      } else {
        results = rrfCombine([keywordHits, v.results]).map((r) => ({
          ...r,
          mode: 'hybrid',
          hybrid_attempted: true,
        }));
        executed_mode = 'hybrid';
        vector_ran = true;
      }
    }

    perStore[name] = results.slice(0, limit);
    allCandidates.push(...perStore[name]);
  }

  const ranked = [...allCandidates].sort((a, b) => b.score - a.score).slice(0, limit);
  const candidate_ids = ranked.map((r) => r.id);
  const scores = Object.fromEntries(ranked.map((r) => [r.id, r.score]));

  // Guard: never report hybrid unless vector actually contributed.
  if (executed_mode === 'hybrid' && !vector_ran) {
    executed_mode = 'keyword_only_vector_unavailable';
    fallback_reason = fallback_reason || 'VECTOR_INDEX_UNAVAILABLE';
  }
  if (
    requested === 'hybrid' &&
    executed_mode === 'hybrid' &&
    !vectorAvailable(options) &&
    !vector_ran
  ) {
    executed_mode = 'keyword_only_vector_unavailable';
    fallback_reason = 'VECTOR_INDEX_UNAVAILABLE';
  }

  const execution = {
    version: RETRIEVAL_VERSION,
    requested_mode: requested,
    executed_mode,
    fallback_reason,
    vector_executed: vector_ran,
    filters: { ...filters },
    store_names: names,
    candidate_ids,
    scores,
    candidates: ranked,
    per_store_counts: Object.fromEntries(
      names.map((n) => [n, (perStore[n] || []).length]),
    ),
    retrieval_id: `ret-${crypto.createHash('sha256').update(JSON.stringify({
      requested, executed_mode, candidate_ids, filters,
    })).digest('hex').slice(0, 16)}`,
  };

  return Object.freeze(execution);
}

/**
 * Convenience: map query plan evidence types → retrieve().
 */
export function retrieveForPlan(plan, stores, options = {}) {
  const mode =
    options.requested_mode ||
    (plan.retrieval_modes || []).find((m) => m === 'hybrid') ||
    (plan.retrieval_modes || []).find((m) => m === 'vector') ||
    (plan.retrieval_modes || []).find((m) => m === 'keyword') ||
    'keyword';

  const filters = {
    ...(plan.constraints || {}),
  };
  if (plan.subject?.release_id) filters.release_id = plan.subject.release_id;
  if (plan.subject?.pressing_id) filters.pressing_id = plan.subject.pressing_id;
  if (plan.subject?.listing_id) filters.listing_id = plan.subject.listing_id;

  return retrieve({
    query: plan.request_text || '',
    stores,
    store_names: plan.evidence_types || null,
    filters,
    requested_mode: mode,
    limit: options.limit || 20,
    vectorIndex: options.vectorIndex || null,
    vectorSearch: options.vectorSearch || null,
  });
}

export default retrieve;
