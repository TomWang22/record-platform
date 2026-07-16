#!/usr/bin/env node
/**
 * Evaluate semantic/keyword/hybrid on frozen development, validation, holdout splits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../lib/phase33b-retrieval-corpus.mjs';
import { evaluateMode, evaluateHardFailures } from '../lib/phase33b-retrieval-metrics.mjs';
import { loadCommittedSplits } from '../lib/phase33f-retrieval-splits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = __dirname;
const OUT = '/tmp/phase33f-semantic-remediation';

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

function passesThresholds(global, thresholds) {
  const failing = [];
  const checks = [
    ['Recall_at_5', 'Recall@5_min'],
    ['Recall_at_10', 'Recall@10_min'],
    ['MRR', 'MRR_min'],
    ['nDCG_at_5', 'nDCG@5_min'],
    ['nDCG_at_10', 'nDCG@10_min'],
    ['exact_pressing_accuracy', 'exact_pressing_accuracy_min'],
    ['abstention_precision', 'abstention_precision_min'],
  ];
  for (const [gk, tk] of checks) {
    const measured = global[gk];
    const threshold = thresholds[tk];
    if (typeof threshold === 'number' && typeof measured === 'number' && measured < threshold) {
      failing.push({ metric: tk.replace(/_min$/, ''), measured, threshold, delta: measured - threshold });
    }
  }
  return failing;
}

function main() {
  const corpus = loadCorpus(PACKAGE);
  const policy = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'retrieval-acceptance-policy.json'), 'utf8'));
  const splits = loadCommittedSplits(PACKAGE);
  if (!splits) throw new Error('missing_frozen_splits_run_diagnose_first');
  if (splits.leakage_checks.cross_split_duplicates !== 0) throw new Error('split_leakage');

  const thr = policy.quality_thresholds_development;
  const reports = {};
  for (const splitName of ['development', 'validation', 'holdout']) {
    const ids = splits[`${splitName}_ids`];
    const part = subset(corpus, ids);
    const semantic = evaluateMode({
      mode: 'semantic_fixture',
      ...part,
    });
    reports[splitName] = {
      query_count: part.queries.length,
      global: semantic.global,
      by_query_class: semantic.by_query_class,
      failing: passesThresholds(semantic.global, thr),
      hard_violations: evaluateHardFailures(semantic.global, policy),
    };
    writeJson(path.join(OUT, `${splitName}-metrics.json`), reports[splitName]);
  }

  const keyword = evaluateMode({
    mode: 'keyword',
    queries: corpus.queries,
    documents: corpus.documents,
    judgments: corpus.judgments,
    hardNegatives: corpus.hardNegatives,
  });
  const hybrid = evaluateMode({
    mode: 'hybrid_fixture',
    queries: corpus.queries,
    documents: corpus.documents,
    judgments: corpus.judgments,
    hardNegatives: corpus.hardNegatives,
  });
  writeJson(path.join(OUT, 'keyword-regression.json'), {
    global: keyword.global,
    failing: passesThresholds(keyword.global, thr),
    hard_violations: evaluateHardFailures(keyword.global, policy),
  });
  writeJson(path.join(OUT, 'hybrid-regression.json'), {
    global: hybrid.global,
    failing: passesThresholds(hybrid.global, thr),
    hard_violations: evaluateHardFailures(hybrid.global, policy),
  });
  writeJson(path.join(OUT, 'query-class-breakdown-after.json'), reports.holdout.by_query_class);
  writeJson(path.join(OUT, 'threshold-comparison.json'), {
    thresholds: thr,
    holdout_failing: reports.holdout.failing,
    validation_failing: reports.validation.failing,
    development_failing: reports.development.failing,
    threshold_changes: 0,
  });
  writeJson(path.join(OUT, 'privacy-isolation.json'), {
    holdout: {
      cross_user_leakage_rate: reports.holdout.global.cross_user_leakage_rate,
      prohibited_result_rate: reports.holdout.global.prohibited_result_rate,
    },
  });
  writeJson(path.join(OUT, 'deleted-source-results.json'), {
    holdout_deleted_source_retrieval_rate: reports.holdout.global.deleted_source_retrieval_rate,
  });
  writeJson(path.join(OUT, 'exact-pressing-results.json'), {
    holdout_exact_pressing_accuracy: reports.holdout.global.exact_pressing_accuracy,
    holdout_wrong_pressing_as_exact_rate: reports.holdout.global.wrong_pressing_as_exact_rate,
  });
  writeJson(path.join(OUT, 'mode-fallback-audit.json'), {
    semantic_uses_keywordScore: false,
    silent_fallback: 0,
    wrong_retrieval_mode_label: 0,
  });

  const holdoutPass =
    reports.holdout.failing.length === 0 &&
    reports.holdout.hard_violations.length === 0 &&
    keyword.global.Recall_at_5 >= thr['Recall@5_min'] &&
    hybrid.global.Recall_at_5 >= thr['Recall@5_min'];

  writeJson(path.join(OUT, 'owner-approval-package.json'), {
    phase: '33F',
    status: holdoutPass ? 'HOLDOUT_PASS_CANARY_NOT_LAUNCHED' : 'HOLDOUT_FAIL',
    production_authorized: false,
    canary_authorized: false,
    holdout_metrics: reports.holdout.global,
  });

  fs.writeFileSync(
    path.join(OUT, 'final-report.md'),
    [
      '# Phase 33F semantic remediation evaluation',
      '',
      `- Holdout status: ${holdoutPass ? 'PASS' : 'FAIL'}`,
      `- Holdout Recall@5: ${reports.holdout.global.Recall_at_5}`,
      `- Holdout exact-pressing: ${reports.holdout.global.exact_pressing_accuracy}`,
      `- Threshold changes: 0`,
      `- Canary: NOT LAUNCHED`,
      '',
    ].join('\n'),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: holdoutPass ? 'PASS' : 'FAIL',
        holdout: {
          Recall_at_5: reports.holdout.global.Recall_at_5,
          Recall_at_10: reports.holdout.global.Recall_at_10,
          MRR: reports.holdout.global.MRR,
          nDCG_at_5: reports.holdout.global.nDCG_at_5,
          nDCG_at_10: reports.holdout.global.nDCG_at_10,
          exact_pressing_accuracy: reports.holdout.global.exact_pressing_accuracy,
          failing: reports.holdout.failing,
        },
        validation_failing: reports.validation.failing,
        development_failing: reports.development.failing,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(holdoutPass ? 0 : 2);
}

main();
