#!/usr/bin/env node
/**
 * Phase 33B offline retrieval evaluator.
 * Modes: keyword | semantic_fixture | hybrid_fixture
 * Writes reports under /tmp/phase33b-retrieval-evaluation/ (never committed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../lib/phase33b-retrieval-corpus.mjs';
import {
  SUPPORTED_MODES,
  evaluateMode,
  evaluateHardFailures,
} from '../lib/phase33b-retrieval-metrics.mjs';
import { validatePhase33bDataLineage } from '../lib/phase33b-data-lineage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PACKAGE = path.join(REPO_ROOT, 'scripts/ai-platform');
const OUT_EVAL = '/tmp/phase33b-retrieval-evaluation';
const OUT_LINEAGE = '/tmp/phase33b-data-lineage';

function parseArgs(argv) {
  const out = { modes: [...SUPPORTED_MODES], outDir: OUT_EVAL };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') {
      const mode = argv[++i];
      if (!SUPPORTED_MODES.includes(mode)) {
        throw new Error(`unsupported_mode:${mode}`);
      }
      out.modes = [mode];
    } else if (a === '--out') {
      out.outDir = argv[++i];
    }
  }
  return out;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const lineage = validatePhase33bDataLineage(REPO_ROOT);
  const corpus = loadCorpus(PACKAGE);
  const policy = JSON.parse(
    fs.readFileSync(path.join(PACKAGE, 'retrieval-acceptance-policy.json'), 'utf8'),
  );

  fs.mkdirSync(OUT_LINEAGE, { recursive: true });
  fs.mkdirSync(args.outDir, { recursive: true });

  writeJson(path.join(OUT_LINEAGE, 'data-source-inventory.json'), {
    status: lineage.status,
    source_count: lineage.source_count,
    privacy_classes: lineage.privacy_classes,
    authorization_scopes: lineage.authorization_scopes,
  });
  writeJson(path.join(OUT_LINEAGE, 'privacy-classification.json'), {
    privacy_classes: lineage.privacy_classes,
    hard_rules: {
      THREAD_PRIVATE_cross_user: false,
      OWNER_PRIVATE_cross_user: false,
      PROHIBITED_embed_retrieve: false,
    },
  });
  writeJson(path.join(OUT_LINEAGE, 'authorization-scope-report.json'), {
    scopes: lineage.authorization_scopes,
  });
  writeJson(path.join(OUT_LINEAGE, 'embedding-lineage-report.json'), {
    embedding_records: corpus.embeddings.length,
    production_writes: false,
    note: 'Fixture metadata only; embedding generation is not model training',
  });
  writeJson(path.join(OUT_LINEAGE, 'deletion-propagation-plan.json'), {
    ledger_note: 'Offline plan only; no production DB migration',
    indexes: ['keyword_index', 'vector_fixture_index', 'hybrid_fixture_index'],
    cases: [
      'updated_listing_supersedes_stale',
      'deleted_listing_disappears',
      'removed_watchlist_disappears',
      'deleted_message_disappears',
      'consent_retract_removes_durable_retrieval',
      'pressing_metadata_change_marks_reembed_required',
      'source_timestamp_in_evidence',
      'stale_sources_labeled_or_excluded',
    ],
  });

  const modeReports = {};
  const hardViolations = [];
  for (const mode of args.modes) {
    const report = evaluateMode({
      mode,
      queries: corpus.queries,
      documents: corpus.documents,
      judgments: corpus.judgments,
      hardNegatives: corpus.hardNegatives,
    });
    modeReports[mode] = report;
    hardViolations.push(...evaluateHardFailures(report.global, policy).map((v) => `${mode}:${v}`));
  }

  const queryClasses = {};
  for (const q of corpus.queries) {
    queryClasses[q.query_class] = (queryClasses[q.query_class] || 0) + 1;
  }
  const hardNegClasses = {};
  for (const h of corpus.hardNegatives) {
    hardNegClasses[h.negative_class] = (hardNegClasses[h.negative_class] || 0) + 1;
  }

  writeJson(path.join(args.outDir, 'corpus-summary.json'), corpus.manifest);
  writeJson(path.join(args.outDir, 'query-class-coverage.json'), queryClasses);
  writeJson(path.join(args.outDir, 'hard-negative-coverage.json'), hardNegClasses);
  writeJson(path.join(args.outDir, 'retrieval-metrics.json'), {
    modes: Object.fromEntries(
      Object.entries(modeReports).map(([mode, r]) => [mode, r.global]),
    ),
    hard_violations: hardViolations,
  });
  writeJson(
    path.join(args.outDir, 'retrieval-metrics-by-capability.json'),
    Object.fromEntries(
      Object.entries(modeReports).map(([mode, r]) => [mode, r.by_capability]),
    ),
  );
  writeJson(path.join(args.outDir, 'privacy-isolation-results.json'), {
    prohibited_result_rate: Object.fromEntries(
      Object.entries(modeReports).map(([m, r]) => [m, r.global.prohibited_result_rate]),
    ),
    cross_user_leakage_rate: Object.fromEntries(
      Object.entries(modeReports).map(([m, r]) => [m, r.global.cross_user_leakage_rate]),
    ),
    deleted_source_retrieval_rate: Object.fromEntries(
      Object.entries(modeReports).map(([m, r]) => [m, r.global.deleted_source_retrieval_rate]),
    ),
  });
  writeJson(path.join(args.outDir, 'owner-approval-package.json'), {
    phase: '33B',
    status: hardViolations.length ? 'HARD_FAILURES_PRESENT' : 'READY_FOR_OWNER_REVIEW',
    production: policy.production_hard_stops,
    note: 'Fixture-only metrics do not approve production defaults',
    next: 'Owner review before Phase 33C',
  });

  const md = [
    '# Phase 33B Retrieval Evaluation (offline fixtures)',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Queries: ${corpus.queries.length}`,
    `- Documents: ${corpus.documents.length}`,
    `- Judgments: ${corpus.judgments.length}`,
    `- Hard negatives: ${corpus.hardNegatives.length}`,
    `- Hard violations: ${hardViolations.length}`,
    '',
    'Production embedding writes: NO',
    'Production DB migration: NO',
    'Live gauntlet: NOT LAUNCHED',
    '',
  ];
  for (const [mode, r] of Object.entries(modeReports)) {
    md.push(`## ${mode}`);
    md.push(`- Recall@5: ${r.global.Recall_at_5.toFixed(4)}`);
    md.push(`- MRR: ${r.global.MRR.toFixed(4)}`);
    md.push(`- nDCG@5: ${r.global.nDCG_at_5.toFixed(4)}`);
    md.push(`- Cross-user leakage: ${r.global.cross_user_leakage_rate}`);
    md.push('');
  }
  fs.writeFileSync(path.join(args.outDir, 'final-report.md'), `${md.join('\n')}\n`, 'utf8');

  // Deletion propagation ledger under /tmp
  writeJson(path.join(OUT_LINEAGE, 'deletion-propagation-ledger.json'), {
    generated_at: new Date().toISOString(),
    deleted_documents: corpus.documents.filter((d) => d.deletion_state === 'DELETED').map((d) => d.document_id),
    note: 'Offline ledger only',
  });

  const summary = {
    status: hardViolations.length ? 'FAIL' : 'PASS',
    modes: Object.fromEntries(
      Object.entries(modeReports).map(([mode, r]) => [mode, r.global]),
    ),
    hard_violations: hardViolations,
    out_eval: args.outDir,
    out_lineage: OUT_LINEAGE,
  };
  for (const line of [
    `modes=${args.modes.join(',')}`,
    `hard_violations=${hardViolations.length}`,
  ]) {
    console.error(line);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(summary.status === 'PASS' ? 0 : 2);
}

try {
  main();
} catch (err) {
  console.error(String(err && err.stack ? err.stack : err));
  process.stdout.write(
    `${JSON.stringify({ status: 'FAIL', error: String(err && err.message ? err.message : err) }, null, 2)}\n`,
  );
  process.exit(2);
}
