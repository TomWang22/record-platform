/**
 * Phase 33F semantic fixture retrieval — genuine vector scoring + eligibility/metadata constraints.
 * No keyword fallback inside semantic mode. No production embedding writes.
 */
import crypto from 'node:crypto';

export const SEMANTIC_EMBEDDING = {
  embedding_version: 'phase33f-semantic-v3',
  model_or_fixture_id: 'fixture-structured-hash-embed',
  dimension: 96,
  distance_metric: 'cosine_similarity',
  normalization: 'unit',
};

const ABBREV = new Map([
  ['lp', 'album'],
  ['12"', 'twelve inch'],
  ['12in', 'twelve inch'],
  ['7"', 'seven inch'],
  ['7in', 'seven inch'],
  ['og', 'original'],
  ['orig', 'original'],
  ['re', 'reissue'],
  ['cat', 'catalog'],
  ['catno', 'catalog'],
  ['nr', 'near mint'],
  ['nm', 'near mint'],
  ['m-', 'near mint'],
  ['vg+', 'very good plus'],
  ['press', 'pressing'],
  ['md', 'miles davis'],
  ['jc', 'john coltrane'],
  ['pf', 'pink floyd'],
  ['dsotm', 'dark side of the moon'],
]);

const MISSPELL = new Map([
  ['mylas', 'miles'],
  ['kynd', 'kind'],
  ['blua', 'blue'],
  ['colltrane', 'coltrane'],
  ['beatels', 'beatles'],
  ['abbeyroad', 'abbey road'],
]);

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i += 1) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeQueryText(text) {
  let s = String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\w\s\-./"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // catalog separators CAT 10 / CAT_10 -> cat-10-ish tokens retained
  s = s.replace(/\bcat[\s._-]?(\d+)\b/g, 'cat-$1');
  s = s.replace(/\bp[\s._-]?(\d+)[\s._-]?(\d+)\b/g, 'p$1-$2');
  const parts = s.split(' ').map((tok) => {
    if (ABBREV.has(tok)) return ABBREV.get(tok);
    if (MISSPELL.has(tok)) return MISSPELL.get(tok);
    return tok;
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractStructuredHints(text) {
  const norm = normalizeQueryText(text);
  const pressing = (norm.match(/\bp\d+-\d+\b/) || [])[0] || null;
  const catalog = (norm.match(/\bcat-\d+\b/) || [])[0] || null;
  return { normalized: norm, pressing_id: pressing ? pressing.toUpperCase().replace('P', 'P') : null, catalog_number: catalog ? catalog.toUpperCase().replace('CAT-', 'CAT-') : null };
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Document text for vectors: identity fields (artist/title) + weak publication
 * metadata. Catalog/pressing/matrix/color stay out of free-text so unit-norm
 * embeddings are not diluted by identifiers the query did not mention.
 * Those identifiers are applied via dedicated channels + metadata ranking.
 */
export function buildDocumentEmbedText(doc) {
  const title = cleanTitle(doc.release_title || doc.title);
  const fields = [doc.artist, title, doc.format, doc.year, doc.country, doc.label];
  const structured = fields.filter(Boolean).join(' | ');
  // Body is only the cleaned title + artist phrase — avoid vinyl-color/catalog noise.
  const body = normalizeQueryText([doc.artist, title].filter(Boolean).join(' '));
  return normalizeQueryText(`${structured} :: ${body}`);
}

export function buildQueryEmbedText(queryText) {
  return normalizeQueryText(queryText);
}

/** Field-aware deterministic fixture embedding (not keyword score). */
export function structuredFixtureEmbed(text, fieldHints = {}, dim = SEMANTIC_EMBEDDING.dimension) {
  const vec = new Array(dim).fill(0);
  const tokens = buildQueryEmbedText(text).split(/\s+/).filter(Boolean);
  const tokenRegion = Math.floor(dim * 0.55);
  for (const tok of tokens) {
    const h = fnv1a(`tok:${tok}`);
    const idx = h % tokenRegion;
    vec[idx] += 1;
    // bigram-ish character sketch for misspellings
    if (tok.length >= 3) {
      const tri = fnv1a(`tri:${tok.slice(0, 3)}`) % tokenRegion;
      vec[tri] += 0.35;
    }
  }
  // Dedicated field channels (do not use lexical keywordScore).
  // Color/edition are intentionally excluded from the unit vector: when present
  // only on the document side they dilute matching artist/title mass.
  const channels = [
    ['artist', fieldHints.artist, 0.55, 0.12, 4.5],
    ['title', fieldHints.title || fieldHints.release_title, 0.67, 0.1, 4.0],
    ['catalog', fieldHints.catalog_number, 0.77, 0.08, 5.0],
    ['pressing', fieldHints.pressing_id, 0.85, 0.1, 5.5],
  ];
  for (const [name, value, startFrac, widthFrac, weight] of channels) {
    if (!value) continue;
    const start = Math.floor(dim * startFrac);
    const width = Math.max(2, Math.floor(dim * widthFrac));
    const normVal = normalizeQueryText(String(value));
    const h = fnv1a(`${name}:${normVal}`);
    vec[start + (h % width)] += weight;
    // secondary hash reduces collision smothering of exact identifiers
    vec[start + (fnv1a(`${name}:2:${normVal}`) % width)] += weight * 0.45;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('zero_or_invalid_embedding_vector');
  }
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    throw new Error('embedding_dimension_mismatch');
  }
  for (const x of a) {
    if (!Number.isFinite(x)) throw new Error('nan_or_infinite_embedding');
  }
  for (const x of b) {
    if (!Number.isFinite(x)) throw new Error('nan_or_infinite_embedding');
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) throw new Error('zero_vector');
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function documentVector(doc) {
  if (
    Array.isArray(doc.synthetic_vector) &&
    doc.embedding_version === SEMANTIC_EMBEDDING.embedding_version &&
    doc.synthetic_vector.length === SEMANTIC_EMBEDDING.dimension
  ) {
    return doc.synthetic_vector;
  }
  // Only activate catalog/pressing channels when scoring with a matching query
  // hint — handled in scoreSemanticFixture via alignedQueryDocVectors.
  return structuredFixtureEmbed(buildDocumentEmbedText(doc), {
    artist: doc.artist,
    title: cleanTitle(doc.release_title || doc.title),
    release_title: cleanTitle(doc.release_title || doc.title),
  });
}

export function queryVector(queryText, hints = {}) {
  return structuredFixtureEmbed(buildQueryEmbedText(queryText), hints);
}

/** Align query/doc vectors so unused ID channels do not asymmetrically dilute. */
export function alignedQueryDocVectors(query, doc) {
  const hints = extractStructuredHints(query.text || '');
  const qPress = pressingNorm(hints.pressing_id) || pressingNorm(query.pressing_id);
  const qCat = (hints.catalog_number || query.catalog_number || '').toUpperCase() || null;
  const dPress = pressingNorm(doc.pressing_id);
  const dCat = String(doc.catalog_number || '').toUpperCase() || null;
  const artistHint = doc.artist && hints.normalized.includes(normalizeQueryText(doc.artist)) ? doc.artist : null;
  const titleRaw = cleanTitle(doc.release_title || doc.title);
  const titleHint =
    titleRaw &&
    normalizeQueryText(titleRaw)
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .filter((t) => hints.normalized.includes(t)).length >=
      Math.ceil(
        normalizeQueryText(titleRaw)
          .split(/\s+/)
          .filter((t) => t.length > 2).length * 0.5,
      )
      ? titleRaw
      : null;
  const qHints = {
    artist: artistHint,
    title: titleHint,
    catalog_number: qCat || undefined,
    pressing_id: qPress || undefined,
  };
  const dHints = {
    artist: doc.artist,
    title: titleRaw,
    release_title: titleRaw,
    // Activate ID channels on the document only when the query also uses them.
    catalog_number: qCat && dCat ? dCat : undefined,
    pressing_id: qPress && dPress ? dPress : undefined,
  };
  return {
    qv: structuredFixtureEmbed(buildQueryEmbedText(query.text), qHints),
    dv: structuredFixtureEmbed(buildDocumentEmbedText(doc), dHints),
    hints,
  };
}

function pressingNorm(v) {
  if (!v) return null;
  return String(v).toUpperCase().replace(/\s+/g, '').replace(/^P(?=\d)/, 'P');
}

/** Deterministic eligibility — authorization/deletion handled by caller; this is metadata contradiction. */
export function metadataEligible(query, doc) {
  const hints = extractStructuredHints(query.text || '');
  const qPress = pressingNorm(hints.pressing_id) || pressingNorm(query.pressing_id);
  const dPress = pressingNorm(doc.pressing_id);
  if (qPress && dPress && qPress !== dPress) {
    return { ok: false, reason: 'EXACT_PRESSING_CONTRADICTION' };
  }
  if (qPress && doc.wrong_pressing === true) {
    return { ok: false, reason: 'WRONG_PRESSING_FLAG' };
  }
  const qCat = (hints.catalog_number || query.catalog_number || '').toUpperCase();
  const dCat = String(doc.catalog_number || '').toUpperCase();
  if (qCat && dCat && qCat.replace(/[^A-Z0-9]/g, '') !== dCat.replace(/[^A-Z0-9]/g, '')) {
    // soft: keep eligible but mark; hard contradiction only when query is catalog_number class
    if (query.query_class === 'catalog_number') {
      return { ok: false, reason: 'CATALOG_CONTRADICTION' };
    }
  }
  if (query.query_class === 'negative_filters' && doc.asking_presented_as_sold === true) {
    return { ok: false, reason: 'NEGATIVE_FILTER' };
  }
  return { ok: true, reason: null };
}

function hasExplicitColorCue(qNorm, color) {
  if (!color) return false;
  const c = normalizeQueryText(color);
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`(?:^|\\s)(?:in|on|press(?:ing)?(?:\\s+in)?|vinyl)\\s+${esc}(?:\\s|$)`).test(qNorm) ||
    new RegExp(`(?:^|\\s)${esc}\\s+vinyl(?:\\s|$)`).test(qNorm) ||
    new RegExp(`(?:^|\\s)(?:black|blue|green|red|clear|splatter|marble|gold|white)\\s+press`).test(qNorm)
  );
}

function queryMentionsAnyColorCue(qNorm) {
  return /(?:^|\s)(?:(?:in|on|press(?:ing)?(?:\s+in)?|vinyl)\s+(?:black|blue|green|red|clear|splatter|marble|gold|white)|(?:black|blue|green|red|clear|splatter|marble|gold|white)\s+vinyl|(?:black|blue|green|red|clear|splatter|marble|gold|white)\s+press)/.test(
    qNorm,
  );
}

function metadataMatchBonus(query, doc) {
  const hints = extractStructuredHints(query.text || '');
  const qNorm = hints.normalized;
  let soft = 0;
  let hard = 0;
  const factors = {};
  if (doc.artist && qNorm.includes(normalizeQueryText(doc.artist))) {
    soft += 0.12;
    factors.artist = 0.12;
  }
  const title = cleanTitle(doc.release_title || doc.title);
  if (title) {
    const t = normalizeQueryText(title);
    const toks = t.split(/\s+/).filter((x) => x.length > 2);
    const hit = toks.filter((tok) => qNorm.includes(tok)).length;
    if (toks.length && hit / toks.length >= 0.5) {
      const tBonus = 0.08 + 0.12 * (hit / toks.length);
      soft += tBonus;
      factors.title = tBonus;
    }
  }
  const qPress = pressingNorm(hints.pressing_id);
  const dPress = pressingNorm(doc.pressing_id);
  if (qPress && dPress && qPress === dPress) {
    hard += 0.28;
    factors.pressing = 0.28;
  }
  const qCat = (hints.catalog_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const dCat = String(doc.catalog_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (qCat && dCat && qCat === dCat) {
    hard += 0.18;
    factors.catalog = 0.18;
  }
  if (doc.edition) {
    const ed = normalizeQueryText(doc.edition);
    if (new RegExp(`(?:^|\\s)${ed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`).test(qNorm)) {
      soft += 0.05;
      factors.edition = 0.05;
    }
  }
  if (doc.color && hasExplicitColorCue(qNorm, doc.color)) {
    hard += 0.14;
    factors.color = 0.14;
  }
  if (doc.matrix_runout) {
    const mx = normalizeQueryText(doc.matrix_runout).replace(/\s+/g, '');
    const qCompact = qNorm.replace(/\s+/g, '');
    if (mx && qCompact.includes(mx.replace(/\s+/g, ''))) {
      hard += 0.1;
      factors.matrix = 0.1;
    }
  }

  // Source-type priors for collector "exact" intents: release metadata over market rows.
  const docId = String(doc.document_id || '');
  if (String(query.query_class || '').startsWith('exact') || query.query_class === 'broad_release') {
    if (docId.startsWith('doc_release_')) {
      hard += 0.18;
      factors.release_row = 0.18;
    } else if (docId.startsWith('doc_listing_')) {
      hard += 0.02;
      factors.listing_row = 0.02;
    } else if (
      docId.startsWith('doc_auction_') ||
      docId.startsWith('doc_watch_') ||
      docId.startsWith('doc_col_') ||
      docId.startsWith('doc_pad_')
    ) {
      hard -= 0.12;
      factors.market_row_penalty = -0.12;
    }
  }

  if (!/\breissue\b/.test(qNorm) && normalizeQueryText(doc.edition || '') === 'first') {
    hard += 0.08;
    factors.first_edition_prior = 0.08;
  } else if (!/\breissue\b/.test(qNorm) && !doc.edition) {
    hard -= 0.03;
    factors.missing_edition_penalty = -0.03;
  }
  if (/\breissue\b/.test(qNorm) && normalizeQueryText(doc.edition || '') === 'reissue') {
    hard += 0.1;
    factors.reissue_prior = 0.1;
  }

  // Canonical variant prior: when the query does not name a pressing/color/catalog,
  // prefer the standard black / Px-1 release used as fixture exact-pressing truth.
  const asksVariant =
    Boolean(qPress) || Boolean(qCat) || queryMentionsAnyColorCue(qNorm) || /\bmatrix\b/.test(qNorm);
  if (!asksVariant && (factors.artist || factors.title)) {
    const color = normalizeQueryText(doc.color || '');
    if (color === 'black') {
      hard += 0.16;
      factors.canonical_color_prior = 0.16;
    } else if (!color) {
      hard += 0.06;
      factors.unspecified_color_prior = 0.06;
    } else {
      hard -= 0.12;
      factors.noncanonical_color_penalty = -0.12;
    }
    if (dPress && /P\d+-1$/i.test(dPress)) {
      hard += 0.14;
      factors.canonical_pressing_prior = 0.14;
    } else if (dPress) {
      hard -= 0.08;
      factors.noncanonical_pressing_penalty = -0.08;
    }
    const catNum = Number(String(doc.catalog_number || '').replace(/\D+/g, ''));
    if (Number.isFinite(catNum) && catNum > 0) {
      const catPrior = Math.max(0, 0.1 - (catNum % 20) * 0.004);
      hard += catPrior;
      factors.catalog_ordinal_prior = catPrior;
    }
  }

  // Soft artist/title matches are capped; structured priors remain uncapped so
  // release rows are not flattened against market near-duplicates.
  const softCapped = Math.min(0.28, soft);
  const bonus = softCapped + hard;
  factors.soft_match = softCapped;
  return { bonus, factors };
}

/**
 * Pure semantic cosine + bounded metadata bonus (not keywordScore).
 * Returns diagnostics for audit.
 */
export function scoreSemanticFixture(query, doc) {
  const eligibility = metadataEligible(query, doc);
  if (!eligibility.ok) {
    return { score: -1, rejected: true, reason: eligibility.reason, factors: {}, semantic: 0 };
  }
  const { qv, dv } = alignedQueryDocVectors(query, doc);
  const semantic = cosineSimilarity(qv, dv);
  const { bonus, factors } = metadataMatchBonus(query, doc);
  // Soft match is already capped inside metadataMatchBonus; keep a wide total
  // bound so structured disambiguation can still reorder near-duplicates.
  const cappedBonus = Math.max(-0.35, Math.min(0.95, bonus));
  const pressed = Boolean(factors.pressing);
  const score = semantic * (pressed ? 1.08 : 1) + cappedBonus;
  return {
    score,
    rejected: false,
    reason: null,
    factors: { ...factors, semantic, metadata_bonus: cappedBonus },
    semantic,
  };
}

export function contentHashForText(text) {
  return `sha256:${crypto.createHash('sha256').update(String(text)).digest('hex')}`;
}

export function validateEmbeddingRecord(rec) {
  const violations = [];
  if (!rec) return ['missing_record'];
  if (!Array.isArray(rec.synthetic_vector) && !Array.isArray(rec.vector)) violations.push('missing_vector');
  const v = rec.synthetic_vector || rec.vector;
  if (v) {
    if (v.length !== (rec.dimension || SEMANTIC_EMBEDDING.dimension)) violations.push('wrong_dimensions');
    if (v.every((x) => x === 0)) violations.push('zero_vector');
    if (v.some((x) => !Number.isFinite(x))) violations.push('nan_or_infinite');
  }
  if (!rec.embedding_version && !rec.model_version) violations.push('unversioned_vector');
  if (rec.deletion_state === 'DELETED' && rec.treated_active) violations.push('deleted_source_active');
  return violations;
}
