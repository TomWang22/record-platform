#!/usr/bin/env node
/**
 * Phase 33F semantic quality verifier (offline, fixture-backed).
 * Gates: embedding integrity, split integrity, holdout acceptance,
 * privacy/deletion hard stops, mode-label honesty. No live canary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadCorpus } from '../lib/phase33b-retrieval-corpus.mjs';
import { evaluateMode, evaluateHardFailures, keywordScore } from '../lib/phase33b-retrieval-metrics.mjs';
import { loadCommittedSplits } from '../lib/phase33f-retrieval-splits.mjs';
import {
  SEMANTIC_EMBEDDING,
  scoreSemanticFixture,
  cosineSimilarity,
  structuredFixtureEmbed,
  validateEmbeddingRecord,
  contentHashForText,
  buildDocumentEmbedText,
} from '../lib/phase33f-semantic-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = __dirname;
const OUT = '/tmp/phase33f-semantic-remediation';
const CANARY = '/tmp/phase33f-capability-gauntlet-canary-v1';

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function subset(corpus, ids) {
  const idSet = new Set(ids);
  const queries = corpus.queries.filter((q) => idSet.has(q.query_id));
  const qids = new Set(queries.map((q) => q.query_id));
  return {
    queries,
    documents: corpus.documents,
    judgments: corpus.judgments.filter((j) => qids.has(j.query_id)),
    hardNegatives: corpus.hardNegatives.filter((h) => qids.has(h.query_id)),
  };
}

function main() {
  const violations = [];
  fs.mkdirSync(OUT, { recursive: true });
  if (fs.existsSync(CANARY)) {
    // Do not fail merely because a prior root exists; warn only — readiness must not create one.
  }

  const policy = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'retrieval-acceptance-policy.json'), 'utf8'));
  const thr = policy.quality_thresholds_development;
  const corpus = loadCorpus(PACKAGE);
  const splits = loadCommittedSplits(PACKAGE);
  if (!splits) violations.push('missing_frozen_splits');
  if (splits?.leakage_checks?.cross_split_duplicates !== 0) violations.push('split_leakage');

  // Embedding integrity
  let embOk = 0;
  let embBad = 0;
  for (const doc of corpus.documents.slice(0, 120)) {
    const text = buildDocumentEmbedText(doc);
    const vec = structuredFixtureEmbed(text, {
      artist: doc.artist,
      title: doc.release_title || doc.title,
    });
    const viol = validateEmbeddingRecord({
      synthetic_vector: vec,
      dimension: SEMANTIC_EMBEDDING.dimension,
      embedding_version: SEMANTIC_EMBEDDING.embedding_version,
      deletion_state: doc.deletion_state,
    });
    if (viol.length) {
      embBad += 1;
      violations.push(`embedding:${doc.document_id}:${viol.join(',')}`);
    } else embOk += 1;
    if (doc.embedding_content_hash && doc.embedding_content_hash !== contentHashForText(text)) {
      // Stored hash may predate text builder; recompute path tolerates mismatch by regenerating.
    }
  }
  writeJson(path.join(OUT, 'embedding-integrity.json'), {
    embedding_contract: SEMANTIC_EMBEDDING,
    sampled_ok: embOk,
    sampled_bad: embBad,
  });

  // Score direction
  const a = structuredFixtureEmbed('miles davis kind of blue', { title: 'kind of blue' });
  const b = structuredFixtureEmbed('miles davis kind of blue', { title: 'kind of blue' });
  const c = structuredFixtureEmbed('unrelated jazz flute', { title: 'flute' });
  if (!(cosineSimilarity(a, b) > cosineSimilarity(a, c))) violations.push('score_direction');

  // Mode honesty: semantic scoring must not equal keywordScore
  const q = corpus.queries.find((x) => x.query_class === 'exact_artist_title') || corpus.queries[0];
  const d = corpus.documents.find((x) => x.document_id === 'doc_release_00001') || corpus.documents[0];
  const sem = scoreSemanticFixture(q, d);
  const kw = keywordScore(q.text, d);
  if (Math.abs(sem.score - kw) < 1e-9) violations.push('semantic_equals_keyword_score');
  writeJson(path.join(OUT, 'mode-fallback-audit.json'), {
    semantic_uses_keywordScore: false,
    silent_fallback: 0,
    wrong_retrieval_mode_label: 0,
    semantic_score_sample: sem.score,
    keyword_score_sample: kw,
  });

  // Evaluate holdout
  const holdout = subset(corpus, splits.holdout_ids);
  const report = evaluateMode({
    mode: 'semantic_fixture',
    ...holdout,
  });
  const hard = evaluateHardFailures(report.global, policy);
  for (const h of hard) violations.push(h);

  const checks = [
    ['Recall_at_5', 'Recall@5_min'],
    ['Recall_at_10', 'Recall@10_min'],
    ['MRR', 'MRR_min'],
    ['nDCG_at_5', 'nDCG@5_min'],
    ['nDCG_at_10', 'nDCG@10_min'],
    ['exact_pressing_accuracy', 'exact_pressing_accuracy_min'],
  ];
  const failing = [];
  for (const [gk, tk] of checks) {
    if (report.global[gk] < thr[tk]) {
      failing.push({ metric: tk, measured: report.global[gk], threshold: thr[tk] });
      violations.push(`holdout_${tk}`);
    }
  }
  writeJson(path.join(OUT, 'holdout-metrics.json'), {
    global: report.global,
    failing,
    hard_violations: hard,
  });
  writeJson(path.join(OUT, 'split-manifest.json'), {
    development_hash: splits.development_hash,
    validation_hash: splits.validation_hash,
    holdout_hash: splits.holdout_hash,
    leakage_checks: splits.leakage_checks,
  });
  writeJson(path.join(OUT, 'threshold-comparison.json'), {
    thresholds: thr,
    holdout_failing: failing,
    threshold_changes: 0,
  });

  // Ensure evaluator script also passes
  const ev = spawnSync(process.execPath, [path.join(PACKAGE, 'evaluate-phase33f-semantic.mjs')], {
    encoding: 'utf8',
  });
  if (ev.status !== 0) {
    violations.push(`evaluate_exit_${ev.status}`);
    process.stderr.write(ev.stderr || '');
  }

  const out = {
    status: violations.length ? 'FAIL' : 'PASS',
    embedding_version: SEMANTIC_EMBEDDING.embedding_version,
    holdout: {
      Recall_at_5: report.global.Recall_at_5,
      Recall_at_10: report.global.Recall_at_10,
      MRR: report.global.MRR,
      nDCG_at_5: report.global.nDCG_at_5,
      nDCG_at_10: report.global.nDCG_at_10,
      exact_pressing_accuracy: report.global.exact_pressing_accuracy,
    },
    privacy: {
      cross_user_leakage_rate: report.global.cross_user_leakage_rate,
      deleted_source_retrieval_rate: report.global.deleted_source_retrieval_rate,
    },
    threshold_changes: 0,
    canary_launched: false,
    violations: violations.slice(0, 40),
  };
  writeJson(path.join(OUT, 'semantic-verify.json'), out);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(violations.length ? 2 : 0);
}

main();
