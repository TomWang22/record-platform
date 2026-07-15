/**
 * Phase 33B offline retrieval metrics (keyword / semantic_fixture / hybrid_fixture).
 * No production embedding writes. No silent mode fallback.
 */

export const SUPPORTED_MODES = ['keyword', 'semantic_fixture', 'hybrid_fixture'];

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function keywordScore(queryText, doc) {
  const q = new Set(tokenize(queryText));
  if (q.size === 0) return 0;
  const hay = tokenize(
    [doc.title, doc.text, doc.artist, doc.release_title, doc.catalog_number, doc.matrix_runout, doc.edition]
      .filter(Boolean)
      .join(' '),
  );
  let hits = 0;
  for (const t of hay) if (q.has(t)) hits += 1;
  const uniq = new Set(hay);
  let cover = 0;
  for (const t of q) if (uniq.has(t)) cover += 1;
  return cover / q.size + hits * 0.01;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic tiny synthetic vector from text (fixture-only). */
export function fixtureEmbed(text, dim = 8) {
  const vec = new Array(dim).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i += 1) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function semanticFixtureScore(queryText, doc) {
  const qv = Array.isArray(doc.query_vector_override)
    ? doc.query_vector_override
    : fixtureEmbed(queryText);
  const dv = Array.isArray(doc.synthetic_vector) ? doc.synthetic_vector : fixtureEmbed(
    [doc.title, doc.text, doc.artist, doc.release_title, doc.catalog_number].filter(Boolean).join(' '),
  );
  return cosine(qv, dv);
}

export function hybridFixtureScore(queryText, doc) {
  return 0.55 * keywordScore(queryText, doc) + 0.45 * semanticFixtureScore(queryText, doc);
}

export function scoreDocument(mode, queryText, doc) {
  switch (mode) {
    case 'keyword':
      return keywordScore(queryText, doc);
    case 'semantic_fixture':
      return semanticFixtureScore(queryText, doc);
    case 'hybrid_fixture':
      return hybridFixtureScore(queryText, doc);
    default: {
      const _exhaustive = mode;
      throw new Error(`unsupported_mode:${_exhaustive}`);
    }
  }
}

export function dcg(rels, k) {
  let s = 0;
  for (let i = 0; i < Math.min(k, rels.length); i += 1) {
    const rel = Math.max(0, Number(rels[i]) || 0);
    s += (2 ** rel - 1) / Math.log2(i + 2);
  }
  return s;
}

export function ndcgAt(gains, k) {
  const actual = dcg(gains, k);
  const ideal = dcg([...gains].sort((a, b) => b - a), k);
  if (ideal === 0) return 0;
  return actual / ideal;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Rank visible documents for a query under authorization + deletion filters.
 */
export function rankForQuery({ mode, query, documents, principalId }) {
  if (!SUPPORTED_MODES.includes(mode)) {
    throw new Error(`unsupported_mode:${mode}`);
  }
  const authorized = new Set(query.authorized_scopes || []);
  const prohibited = new Set(query.prohibited_scopes || []);
  const scored = [];
  for (const doc of documents) {
    if (doc.deletion_state === 'DELETED' || doc.deletion_state === 'DELETE_PENDING') {
      continue;
    }
    if (prohibited.has(doc.authorization_scope)) continue;
    if (!authorized.has(doc.authorization_scope)) continue;
    if (doc.privacy_class === 'PROHIBITED') continue;
    // Fixture safety filters (hard stops): never surface ask-as-sold traps or
    // unlabeled stale rows; never surface another principal's private docs.
    if (doc.asking_presented_as_sold === true) continue;
    if (doc.stale === true && doc.stale_labeled !== true) continue;
    if (
      (doc.privacy_class === 'OWNER_PRIVATE' ||
        doc.privacy_class === 'THREAD_PRIVATE' ||
        doc.privacy_class === 'DERIVED_PRIVATE') &&
      doc.owner_principal_fixture &&
      doc.owner_principal_fixture !== principalId
    ) {
      continue;
    }
    const score = scoreDocument(mode, query.text, doc);
    if (score <= 0) continue;
    scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || a.doc.document_id.localeCompare(b.doc.document_id));
  return scored;
}

export function evaluateMode({
  mode,
  queries,
  documents,
  judgments,
  hardNegatives = [],
  kList = [1, 5, 10],
}) {
  if (!SUPPORTED_MODES.includes(mode)) {
    throw new Error(`unsupported_mode:${mode}`);
  }
  const byQuery = new Map();
  for (const j of judgments) {
    if (!byQuery.has(j.query_id)) byQuery.set(j.query_id, []);
    byQuery.get(j.query_id).push(j);
  }
  const hardByQuery = new Map();
  for (const h of hardNegatives) {
    if (!hardByQuery.has(h.query_id)) hardByQuery.set(h.query_id, []);
    hardByQuery.get(h.query_id).push(h);
  }

  const perQuery = [];
  let prohibitedHits = 0;
  let leakageHits = 0;
  let deletedHits = 0;
  let wrongPressingExact = 0;
  let askingAsSold = 0;
  let staleUnlabeled = 0;
  let rankedTotal = 0;

  for (const query of queries) {
    const principalId = query.requesting_principal_fixture;
    const ranked = rankForQuery({ mode, query, documents, principalId });
    const top = ranked.slice(0, 10);
    rankedTotal += top.length;
    const gradeMap = new Map((byQuery.get(query.query_id) || []).map((j) => [j.document_id, j]));
    const gains = top.map((r) => {
      const j = gradeMap.get(r.doc.document_id);
      return j ? Number(j.relevance_grade) : 0;
    });

    const relevantIds = new Set(
      (byQuery.get(query.query_id) || [])
        .filter((j) => Number(j.relevance_grade) >= 2 && j.authorized !== false)
        .map((j) => j.document_id),
    );

    const metrics = {};
    for (const k of kList) {
      const hit = top.slice(0, k).some((r) => relevantIds.has(r.doc.document_id));
      metrics[`Recall@${k}`] = relevantIds.size === 0 ? (query.expect_abstention ? 1 : 0) : hit ? 1 : 0;
      const precHits = top.slice(0, k).filter((r) => relevantIds.has(r.doc.document_id)).length;
      metrics[`Precision@${k}`] = k === 0 ? 0 : precHits / k;
      metrics[`nDCG@${k}`] = ndcgAt(gains, k);
    }
    let rr = 0;
    for (let i = 0; i < top.length; i += 1) {
      if (relevantIds.has(top[i].doc.document_id)) {
        rr = 1 / (i + 1);
        break;
      }
    }
    metrics.MRR = rr;
    metrics.zero_result = top.length === 0 ? 1 : 0;
    metrics.abstention_correct =
      query.expect_abstention && (top.length === 0 || query.expected_gate === 'abstain') ? 1 : 0;

    // Hard failure scanners over top-10
    for (const r of top) {
      const doc = r.doc;
      if (doc.privacy_class === 'PROHIBITED' || Number(gradeMap.get(doc.document_id)?.relevance_grade) === -1) {
        prohibitedHits += 1;
      }
      if (
        doc.owner_principal_fixture &&
        doc.owner_principal_fixture !== principalId &&
        (doc.privacy_class === 'OWNER_PRIVATE' || doc.privacy_class === 'THREAD_PRIVATE')
      ) {
        leakageHits += 1;
      }
      if (doc.deletion_state === 'DELETED') deletedHits += 1;
      const j = gradeMap.get(doc.document_id);
      if (j && j.exact_pressing_match === true && doc.wrong_pressing === true) wrongPressingExact += 1;
      if (doc.asking_presented_as_sold === true) askingAsSold += 1;
      if (doc.stale === true && doc.stale_labeled !== true && (!j || j.fresh !== false)) staleUnlabeled += 1;
    }

    // Exact release / pressing accuracy among grade-3 judgments present
    const topIds = new Set(top.map((r) => r.doc.document_id));
    const exactReleaseNeeded = (byQuery.get(query.query_id) || []).filter((j) => j.exact_release_match);
    const exactPressingNeeded = (byQuery.get(query.query_id) || []).filter((j) => j.exact_pressing_match);
    metrics.exact_release_accuracy =
      exactReleaseNeeded.length === 0
        ? null
        : exactReleaseNeeded.some((j) => topIds.has(j.document_id))
          ? 1
          : 0;
    metrics.exact_pressing_accuracy =
      exactPressingNeeded.length === 0
        ? null
        : exactPressingNeeded.some((j) => topIds.has(j.document_id))
          ? 1
          : 0;

    perQuery.push({
      query_id: query.query_id,
      capability_id: query.capability_id,
      query_class: query.query_class,
      participant_side: query.participant_side,
      experience_level: query.experience_level,
      data_density_class: query.data_density_class,
      privacy_class: query.privacy_focus || 'n/a',
      language_noise_class: query.language_noise_class,
      metrics,
      top_document_ids: top.map((r) => r.doc.document_id),
    });
  }

  const aggregate = (key) => mean(perQuery.map((p) => p.metrics[key]).filter((v) => typeof v === 'number'));
  const global = {
    mode,
    query_count: queries.length,
    Recall_at_1: aggregate('Recall@1'),
    Recall_at_5: aggregate('Recall@5'),
    Recall_at_10: aggregate('Recall@10'),
    Precision_at_5: aggregate('Precision@5'),
    Precision_at_10: aggregate('Precision@10'),
    MRR: aggregate('MRR'),
    nDCG_at_5: aggregate('nDCG@5'),
    nDCG_at_10: aggregate('nDCG@10'),
    exact_release_accuracy: mean(
      perQuery.map((p) => p.metrics.exact_release_accuracy).filter((v) => typeof v === 'number'),
    ),
    exact_pressing_accuracy: mean(
      perQuery.map((p) => p.metrics.exact_pressing_accuracy).filter((v) => typeof v === 'number'),
    ),
    zero_result_rate: aggregate('zero_result'),
    abstention_precision: mean(
      perQuery.filter((p) => queries.find((q) => q.query_id === p.query_id)?.expect_abstention).map(
        (p) => p.metrics.abstention_correct,
      ),
    ),
    prohibited_result_rate: rankedTotal === 0 ? 0 : prohibitedHits / rankedTotal,
    owner_scope_leakage_rate: rankedTotal === 0 ? 0 : leakageHits / rankedTotal,
    cross_user_leakage_rate: rankedTotal === 0 ? 0 : leakageHits / rankedTotal,
    deleted_source_retrieval_rate: rankedTotal === 0 ? 0 : deletedHits / rankedTotal,
    wrong_pressing_as_exact_rate: rankedTotal === 0 ? 0 : wrongPressingExact / rankedTotal,
    asking_as_sold_rate: rankedTotal === 0 ? 0 : askingAsSold / rankedTotal,
    stale_unlabeled_rate: rankedTotal === 0 ? 0 : staleUnlabeled / rankedTotal,
  };

  function groupBy(field) {
    const groups = new Map();
    for (const row of perQuery) {
      const key = row[field] || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const out = {};
    for (const [key, rows] of groups) {
      out[key] = {
        count: rows.length,
        Recall_at_5: mean(rows.map((r) => r.metrics['Recall@5'])),
        MRR: mean(rows.map((r) => r.metrics.MRR)),
        nDCG_at_5: mean(rows.map((r) => r.metrics['nDCG@5'])),
      };
    }
    return out;
  }

  return {
    global,
    by_capability: groupBy('capability_id'),
    by_query_class: groupBy('query_class'),
    by_participant_side: groupBy('participant_side'),
    by_experience_level: groupBy('experience_level'),
    by_data_density_class: groupBy('data_density_class'),
    by_privacy_class: groupBy('privacy_class'),
    by_language_noise_class: groupBy('language_noise_class'),
    per_query: perQuery,
    hard_negative_count: hardNegatives.length,
  };
}

export function evaluateHardFailures(global, policy) {
  const hf = policy.hard_failures;
  const violations = [];
  const checks = [
    ['prohibited_result_rate', global.prohibited_result_rate, hf.prohibited_result_rate_max],
    ['owner_scope_leakage_rate', global.owner_scope_leakage_rate, hf.owner_scope_leakage_rate_max],
    ['cross_user_leakage_rate', global.cross_user_leakage_rate, hf.cross_user_leakage_rate_max],
    ['deleted_source_retrieval_rate', global.deleted_source_retrieval_rate, hf.deleted_source_retrieval_rate_max],
    ['wrong_pressing_as_exact_rate', global.wrong_pressing_as_exact_rate, hf.wrong_pressing_as_exact_rate_max],
    ['asking_as_sold_rate', global.asking_as_sold_rate, hf.asking_as_sold_rate_max],
    ['stale_unlabeled_rate', global.stale_unlabeled_rate, hf.stale_result_without_stale_label_rate_max],
  ];
  for (const [name, value, max] of checks) {
    if (value > max) violations.push(`hard_failure:${name}:${value}>${max}`);
  }
  return violations;
}
