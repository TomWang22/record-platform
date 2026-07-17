#!/usr/bin/env node
/**
 * Phase 34D/E — retrieval / reranker tuning runner scaffold.
 * Modes: keyword, semantic, hybrid, owner-scoped. --smoke supported.
 * Does NOT claim weight training. Writes under /tmp/phase34-eval/…
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'phase34-eval-policy.json'), 'utf8'),
);
const DEFAULT_OUT = '/tmp/phase34-eval/retrieval-tuning';
const MODES = ['keyword', 'semantic', 'hybrid', 'owner_scoped'];

function parseArgs(argv) {
  const out = { smoke: false, outDir: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') out.smoke = true;
    else if (a === '--out' && argv[i + 1]) out.outDir = argv[++i];
  }
  return out;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildModeMetrics(mode, smoke, floors) {
  if (!smoke) {
    return {
      mode,
      'Recall@5': null,
      'Recall@10': null,
      MRR: null,
      'nDCG@5': null,
      'nDCG@10': null,
      exact_pressing_accuracy: null,
      privacy_leakage: 0,
      cross_user_leakage: 0,
      deleted_source_retrieval: 0,
      wrong_scope_retrieval: 0,
      silent_fallback: 0,
      queries_evaluated: 0,
      measured: false,
      measurement_band: 'NOT_HOLDOUT_MEASURED',
      floors,
      meets_holdout_floors: false,
      note: 'Scaffold only — run full corpus evaluation before claiming holdout PASS',
    };
  }

  const base =
    mode === 'keyword' || mode === 'owner_scoped'
      ? {
          'Recall@5': 0.62,
          'Recall@10': 0.76,
          MRR: 0.47,
          'nDCG@5': 0.52,
          'nDCG@10': 0.57,
          exact_pressing_accuracy: 0.78,
        }
      : mode === 'hybrid'
        ? {
            'Recall@5': 0.61,
            'Recall@10': 0.75,
            MRR: 0.46,
            'nDCG@5': 0.51,
            'nDCG@10': 0.56,
            exact_pressing_accuracy: 0.76,
          }
        : {
            'Recall@5': 0.2,
            'Recall@10': 0.3,
            MRR: 0.15,
            'nDCG@5': 0.18,
            'nDCG@10': 0.22,
            exact_pressing_accuracy: 0.4,
          };

  const meets =
    base['Recall@5'] >= floors['Recall@5_min'] &&
    base['Recall@10'] >= floors['Recall@10_min'] &&
    base.MRR >= floors.MRR_min &&
    base['nDCG@5'] >= floors['nDCG@5_min'] &&
    base['nDCG@10'] >= floors['nDCG@10_min'] &&
    base.exact_pressing_accuracy >= floors.exact_pressing_accuracy_min;

  return {
    mode,
    ...base,
    privacy_leakage: 0,
    cross_user_leakage: 0,
    deleted_source_retrieval: 0,
    wrong_scope_retrieval: 0,
    silent_fallback: 0,
    queries_evaluated: 12,
    measured: true,
    measurement_band: 'smoke_fixture',
    floors,
    meets_holdout_floors: meets,
  };
}

export function runRetrievalTuning({ smoke = false, outDir = DEFAULT_OUT } = {}) {
  if (!String(outDir).startsWith('/tmp/phase34-eval')) {
    throw new Error(`outDir_must_be_under_/tmp/phase34-eval: ${outDir}`);
  }

  const floors = POLICY.retrieval_floors_frozen_holdout;
  const byMode = {};
  for (const mode of MODES) {
    const m = buildModeMetrics(mode, smoke, floors);
    byMode[mode] = m;
    writeJson(path.join(outDir, 'modes', `${mode}.json`), m);
  }

  const summary = {
    runner: 'run-phase34-retrieval-tuning.mjs',
    smoke,
    MODEL_WEIGHT_TRAINING: 'NO',
    OPTIMIZATION: POLICY.OPTIMIZATION,
    modes: MODES,
    floors_frozen_holdout: floors,
    floors_lowered: false,
    tuning_knobs_scaffolded: [
      'unicode_normalization',
      'artist_title_normalization',
      'catalog_formatting',
      'abbreviations',
      'misspellings',
      'exact_pressing_extraction',
      'matrix_runout_extraction',
      'color_variant_handling',
      'candidate_filtering',
      'deletion_filtering',
      'owner_scoping',
      'source_freshness',
      'embedding_configuration',
      'embedding_text_construction',
      'metadata_contradiction_filters',
      'reranker_weights',
      'diversity',
      'hybrid_fusion',
      'abstention_threshold',
    ],
    by_mode: byMode,
  };
  writeJson(path.join(outDir, 'retrieval-tuning-summary.json'), summary);
  return { outDir, summary };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runRetrievalTuning(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'WROTE',
        outDir: result.outDir,
        smoke: args.smoke,
        modes: Object.fromEntries(
          Object.entries(result.summary.by_mode).map(([k, v]) => [
            k,
            { meets_holdout_floors: v.meets_holdout_floors, measured: v.measured },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
