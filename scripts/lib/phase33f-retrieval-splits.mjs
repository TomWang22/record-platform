/**
 * Deterministic development / validation / holdout splits for Phase 33F semantic remediation.
 * Freeze before tuning. No query movement after freeze.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SPLIT_SEED = 'phase33f-semantic-split-v1';
export const SPLIT_RATIOS = { development: 0.6, validation: 0.2, holdout: 0.2 };

function hashToUnit(queryId, seed = SPLIT_SEED) {
  const h = crypto.createHash('sha256').update(`${seed}|${queryId}`).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

export function assignSplit(queryId, seed = SPLIT_SEED) {
  const u = hashToUnit(queryId, seed);
  if (u < SPLIT_RATIOS.development) return 'development';
  if (u < SPLIT_RATIOS.development + SPLIT_RATIOS.validation) return 'validation';
  return 'holdout';
}

export function buildSplitManifest(queries, judgments, documents, { seed = SPLIT_SEED } = {}) {
  const buckets = { development: [], validation: [], holdout: [] };
  for (const q of queries) {
    buckets[assignSplit(q.query_id, seed)].push(q.query_id);
  }
  for (const k of Object.keys(buckets)) buckets[k].sort();

  const hashIds = (ids) =>
    crypto.createHash('sha256').update(ids.join('\n')).digest('hex');

  const queryClasses = {};
  for (const q of queries) {
    queryClasses[q.query_class] = (queryClasses[q.query_class] || 0) + 1;
  }

  const allIds = new Set(queries.map((q) => q.query_id));
  const union = new Set([...buckets.development, ...buckets.validation, ...buckets.holdout]);
  const leakage = [];
  for (const a of ['development', 'validation', 'holdout']) {
    for (const b of ['development', 'validation', 'holdout']) {
      if (a >= b) continue;
      const setB = new Set(buckets[b]);
      for (const id of buckets[a]) {
        if (setB.has(id)) leakage.push(`${a}|${b}|${id}`);
      }
    }
  }

  return {
    schema_version: 1,
    phase: '33F',
    seed,
    split_algorithm: 'sha256(seed|query_id) -> [0,1) banded 60/20/20',
    corpus_version: 'phase33b-dev-band+phase33f-semantic-v3',
    query_count: queries.length,
    document_count: documents.length,
    judgment_count: judgments.length,
    query_class_counts: queryClasses,
    development_ids: buckets.development,
    validation_ids: buckets.validation,
    holdout_ids: buckets.holdout,
    development_hash: hashIds(buckets.development),
    validation_hash: hashIds(buckets.validation),
    holdout_hash: hashIds(buckets.holdout),
    duplicate_checks: {
      unique_queries: allIds.size === queries.length,
      union_covers_all: union.size === allIds.size,
    },
    leakage_checks: {
      cross_split_duplicates: leakage.length,
      leakage,
    },
    frozen_before_tuning: true,
  };
}

export function loadCommittedSplits(packageRoot) {
  const file = path.join(packageRoot, 'retrieval-splits', 'phase33f-semantic-splits.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function filterBySplit(items, idField, idSet) {
  return items.filter((row) => idSet.has(row[idField]));
}
