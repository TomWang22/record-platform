/**
 * Shared entity / pressing resolution (Phase B3).
 */
import crypto from 'node:crypto';

export const RESOLUTION_STATUSES = Object.freeze([
  'MATCHED_EXACT_PRESSING',
  'MATCHED_RELEASE_ONLY',
  'AMBIGUOUS',
  'UNRESOLVED',
]);

function norm(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function catalogNorm(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function subjectHash(subject = {}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        artist: norm(subject.artist),
        title: norm(subject.title),
        label: norm(subject.label),
        catalog: catalogNorm(subject.catalog_number || subject.catalogNumber),
        release_id: subject.release_id || null,
        pressing_id: subject.pressing_id || null,
        country: norm(subject.country),
        year: subject.release_year || subject.year || null,
        matrix: norm(subject.matrix_runout || subject.matrix),
        format: norm(subject.format),
        edition: norm(subject.edition),
      }),
    )
    .digest('hex');
}

/**
 * Resolve a subject against optional catalog candidates.
 * Returns exactly one RESOLUTION_STATUS.
 */
export function resolveEntity(subject = {}, candidates = []) {
  const matched_fields = [];
  const missing_fields = [];
  const conflicting_fields = [];
  const fields = [
    'artist',
    'title',
    'label',
    'catalog_number',
    'release_id',
    'pressing_id',
    'country',
    'release_year',
    'matrix_runout',
    'format',
    'edition',
  ];

  for (const f of fields) {
    const v = subject[f] ?? subject[f.replace('_', '')];
    if (v == null || v === '') missing_fields.push(f);
  }

  const pressingId = subject.pressing_id || null;
  const releaseId = subject.release_id || null;
  const catalog = catalogNorm(subject.catalog_number || subject.catalogNumber);

  let resolution_status = 'UNRESOLVED';
  let confidence = 0;
  let resolved_release_id = releaseId;
  let resolved_pressing_id = pressingId;
  const candidate_alternatives = [];

  const pool = Array.isArray(candidates) ? candidates : [];
  if (pressingId) {
    const exact = pool.filter((c) => c.pressing_id && c.pressing_id === pressingId);
    if (exact.length === 1 || (exact.length === 0 && catalog)) {
      resolution_status = 'MATCHED_EXACT_PRESSING';
      confidence = exact.length === 1 ? 0.95 : 0.85;
      matched_fields.push('pressing_id');
      if (catalog) matched_fields.push('catalog_number');
      resolved_pressing_id = pressingId;
      resolved_release_id = exact[0]?.release_id || releaseId;
    } else if (exact.length > 1) {
      resolution_status = 'AMBIGUOUS';
      confidence = 0.4;
      conflicting_fields.push('pressing_id');
      for (const c of exact) candidate_alternatives.push(c);
    }
  } else if (releaseId || catalog) {
    const releaseMatches = pool.filter(
      (c) =>
        (releaseId && c.release_id === releaseId) ||
        (catalog && catalogNorm(c.catalog_number) === catalog),
    );
    if (releaseMatches.length === 1) {
      resolution_status = 'MATCHED_RELEASE_ONLY';
      confidence = 0.7;
      matched_fields.push(releaseId ? 'release_id' : 'catalog_number');
      resolved_release_id = releaseMatches[0].release_id || releaseId;
    } else if (releaseMatches.length > 1) {
      resolution_status = 'AMBIGUOUS';
      confidence = 0.45;
      conflicting_fields.push('release_id');
      for (const c of releaseMatches.slice(0, 5)) candidate_alternatives.push(c);
    } else if (releaseId || catalog) {
      resolution_status = 'MATCHED_RELEASE_ONLY';
      confidence = 0.55;
      matched_fields.push(releaseId ? 'release_id' : 'catalog_number');
    }
  }

  if (norm(subject.artist) && norm(subject.title)) {
    matched_fields.push('artist', 'title');
    if (resolution_status === 'UNRESOLVED') {
      resolution_status = 'UNRESOLVED';
      confidence = Math.max(confidence, 0.2);
    }
  }

  return Object.freeze({
    resolution_id: `res-${subjectHash(subject).slice(0, 20)}`,
    subject_hash: subjectHash(subject),
    resolution_status,
    resolved_release_id,
    resolved_pressing_id,
    confidence,
    matched_fields: [...new Set(matched_fields)],
    conflicting_fields,
    missing_fields,
    candidate_alternatives,
    resolution_version: 'phase34-entity-resolution-v1',
    input_subject: subject,
  });
}

export function assertExactPressingOnly(resolution, evidenceItems = []) {
  if (resolution.resolution_status !== 'MATCHED_EXACT_PRESSING') {
    return evidenceItems.filter((e) => e.pressing_match !== 'EXACT_PRESSING_MATCH');
  }
  return evidenceItems;
}
