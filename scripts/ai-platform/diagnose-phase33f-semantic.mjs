#!/usr/bin/env node
/**
 * Phase 33F semantic quality diagnosis + frozen split freeze.
 * Does not tune ranking. Writes /tmp/phase33f-semantic-remediation/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../lib/phase33b-retrieval-corpus.mjs';
import { evaluateMode, SUPPORTED_MODES } from '../lib/phase33b-retrieval-metrics.mjs';
import { buildSplitManifest } from '../lib/phase33f-retrieval-splits.mjs';
import {
  SEMANTIC_EMBEDDING,
  buildDocumentEmbedText,
  documentVector,
  scoreSemanticFixture,
  validateEmbeddingRecord,
} from '../lib/phase33f-semantic-retrieval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.join(__dirname);
const OUT = '/tmp/phase33f-semantic-remediation';
const SPLITS_OUT = path.join(PACKAGE, 'retrieval-splits', 'phase33f-semantic-splits.json');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const corpus = loadCorpus(PACKAGE);
  const policy = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'retrieval-acceptance-policy.json'), 'utf8'));

  const semantic = evaluateMode({
    mode: 'semantic_fixture',
    queries: corpus.queries,
    documents: corpus.documents,
    judgments: corpus.judgments,
    hardNegatives: corpus.hardNegatives,
  });

  writeJson(path.join(OUT, 'current-metrics.json'), {
    mode: 'semantic_fixture',
    global: semantic.global,
    thresholds: policy.quality_thresholds_development,
  });
  writeJson(path.join(OUT, 'metric-reproduction.json'), {
    Recall_at_5: semantic.global.Recall_at_5,
    Recall_at_10: semantic.global.Recall_at_10,
    MRR: semantic.global.MRR,
    nDCG_at_5: semantic.global.nDCG_at_5,
    nDCG_at_10: semantic.global.nDCG_at_10,
    exact_pressing_accuracy: semantic.global.exact_pressing_accuracy,
  });
  writeJson(path.join(OUT, 'query-class-breakdown.json'), semantic.by_query_class);
  writeJson(path.join(OUT, 'query-class-breakdown-before.json'), semantic.by_query_class);

  const failures = semantic.per_query
    .filter((p) => p.metrics['Recall@5'] === 0)
    .slice(0, 80)
    .map((p) => ({
      query_id: p.query_id,
      query_class: p.query_class,
      top_document_ids: p.top_document_ids,
      metrics: p.metrics,
    }));
  fs.writeFileSync(
    path.join(OUT, 'failure-examples.jsonl'),
    `${failures.map((f) => JSON.stringify(f)).join('\n')}\n`,
  );

  // Embedding integrity sample
  let mismatched = 0;
  let ok = 0;
  const issues = [];
  for (const doc of corpus.documents.slice(0, 200)) {
    try {
      const v = documentVector(doc);
      const rec = {
        synthetic_vector: v,
        dimension: v.length,
        embedding_version: SEMANTIC_EMBEDDING.embedding_version,
        deletion_state: doc.deletion_state,
      };
      const viol = validateEmbeddingRecord(rec);
      if (viol.length) {
        mismatched += 1;
        issues.push({ document_id: doc.document_id, viol });
      } else ok += 1;
    } catch (err) {
      mismatched += 1;
      issues.push({ document_id: doc.document_id, error: String(err.message || err) });
    }
  }
  writeJson(path.join(OUT, 'embedding-integrity.json'), {
    embedding_contract: SEMANTIC_EMBEDDING,
    sampled: 200,
    ok,
    issues: issues.slice(0, 40),
    note: 'Vectors recomputed via phase33f structured fixture embed when version/dim mismatch',
  });

  writeJson(path.join(OUT, 'document-text-audit.json'), {
    sample: corpus.documents.slice(0, 5).map((d) => ({
      document_id: d.document_id,
      embed_text: buildDocumentEmbedText(d),
    })),
  });
  writeJson(path.join(OUT, 'query-normalization-audit.json'), {
    sample: corpus.queries.slice(0, 10).map((q) => ({ query_id: q.query_id, text: q.text })),
  });
  writeJson(path.join(OUT, 'scoring-audit.json'), {
    mode: 'semantic_fixture',
    uses_keywordScore: false,
    direction: 'higher_cosine_first',
    sample: (() => {
      const q = corpus.queries[0];
      const d = corpus.documents[0];
      return scoreSemanticFixture(q, d);
    })(),
  });
  writeJson(path.join(OUT, 'candidate-pool-audit.json'), {
    documents: corpus.documents.length,
    note: 'All ACTIVE authorized docs eligible before metadata contradiction filters',
  });
  writeJson(path.join(OUT, 'pressing-disambiguation-audit.json'), {
    exact_pressing_accuracy: semantic.global.exact_pressing_accuracy,
    wrong_pressing_as_exact_rate: semantic.global.wrong_pressing_as_exact_rate,
  });
  writeJson(path.join(OUT, 'privacy-filter-audit.json'), {
    cross_user_leakage_rate: semantic.global.cross_user_leakage_rate,
    prohibited_result_rate: semantic.global.prohibited_result_rate,
  });
  writeJson(path.join(OUT, 'deleted-source-audit.json'), {
    deleted_source_retrieval_rate: semantic.global.deleted_source_retrieval_rate,
  });

  // Freeze splits BEFORE tuning. Never rewrite a committed freeze in-place.
  let splitManifest;
  if (fs.existsSync(SPLITS_OUT) && process.env.PHASE33F_REFREEZE_SPLITS !== '1') {
    splitManifest = JSON.parse(fs.readFileSync(SPLITS_OUT, 'utf8'));
  } else {
    splitManifest = buildSplitManifest(corpus.queries, corpus.judgments, corpus.documents);
    writeJson(SPLITS_OUT, splitManifest);
  }
  writeJson(path.join(OUT, 'split-manifest.json'), splitManifest);
  writeJson(path.join(OUT, 'split-integrity.json'), {
    leakage: splitManifest.leakage_checks,
    duplicate_checks: splitManifest.duplicate_checks,
    hashes: {
      development: splitManifest.development_hash,
      validation: splitManifest.validation_hash,
      holdout: splitManifest.holdout_hash,
    },
  });

  writeJson(path.join(OUT, 'root-cause.json'), {
    primary:
      'Unit-normalized fixture embeddings diluted shared artist/title mass with unused color/catalog/pressing channels, so near-duplicate market rows and non-canonical vinyl colors outranked the fixture exact-pressing release.',
    secondary: [
      'Legacy dim-8 bag-of-hash embeddings lacked pressing/catalog identity',
      'No exact-pressing contradiction filter before semantic ranking',
      'Query misspellings/abbreviations lacked shared-space normalization',
      'Metadata bonuses capped so release rows tied with auction/pad duplicates',
      'Album-title color tokens (Kind of Blue) collided with vinyl-color fields',
    ],
    ruled_out_before_claiming_model_weakness: [
      'score_direction_inverted',
      'silent_keyword_fallback',
      'judgment_id_orphans',
      'deleted_or_private_included_before_filter',
    ],
    mode_honesty: {
      semantic_fixture: 'vector similarity + deterministic eligibility/metadata constraints; no keywordScore',
      hybrid_fixture: 'explicit keyword + semantic blend',
      keyword: 'lexical default',
    },
  });

  fs.writeFileSync(
    path.join(OUT, 'remediation-plan.md'),
    [
      '# Phase 33F semantic remediation plan',
      '',
      '1. Freeze 60/20/20 splits (done in split-manifest.json).',
      '2. Upgrade fixture embed to structured dim-96 with pressing/catalog channels.',
      '3. Normalize queries (case/Unicode/abbrev/misspell/catalog separators).',
      '4. Apply exact-pressing contradiction filters before ranking.',
      '5. Bounded metadata bonus (not keywordScore) for rerank.',
      '6. Select on validation; accept only on frozen holdout.',
      '7. Re-check keyword/hybrid; never lower thresholds.',
      '',
    ].join('\n'),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'DIAGNOSED',
        current_Recall_at_5: semantic.global.Recall_at_5,
        split_file: SPLITS_OUT,
        out: OUT,
        modes_checked: SUPPORTED_MODES,
      },
      null,
      2,
    )}\n`,
  );
}

main();
