#!/usr/bin/env node
/**
 * CI entry — Phase F semantic evaluation.
 * Expands compact corpus and asserts core semantic gates PASS.
 * Does not launch owner-proof, screenshots, or attempt 7.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SEMANTIC_ASSERTION_CLASSES,
  CORE_SEMANTIC_GATES,
  HUMAN_QUALITY_FLOOR,
} from '../lib/phase34-semantic-evaluation.mjs';
import {
  writeCompactCorpus,
  loadCompactCorpus,
  runCorpusCiDryRun,
  corpusCapabilitySessionCounts,
  MIN_COMPACT_EVALUATED_TURNS,
  MIN_EXPANDED_EVALUATED_TURNS,
  DEFAULT_CORPUS_DIR,
  CORPUS_VERSION,
} from '../lib/phase34-semantic-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'PHASE34_SEMANTIC_EVAL_VERIFY_FAIL';
    throw err;
  }
}

function main() {
  const corpusDir = process.env.PHASE34_SEMANTIC_CORPUS_DIR || DEFAULT_CORPUS_DIR;
  const seed = process.env.PHASE34_SEMANTIC_EXPAND_SEED || 'phase34-ci-expand-v1';

  // Ensure checked-in compact corpus exists (generate if missing in fresh checkouts).
  const compactPath = path.join(corpusDir, 'compact-corpus.json');
  if (!fs.existsSync(compactPath)) {
    writeCompactCorpus(corpusDir);
  }

  const compact = loadCompactCorpus(corpusDir);
  assert(compact.corpus_version === CORPUS_VERSION, 'corpus version mismatch');
  assert(
    compact.evaluated_turn_count >= MIN_COMPACT_EVALUATED_TURNS,
    `compact turns ${compact.evaluated_turn_count} < ${MIN_COMPACT_EVALUATED_TURNS}`,
  );

  const sessionCounts = corpusCapabilitySessionCounts(compact);
  for (const [cap, n] of Object.entries(sessionCounts)) {
    assert(n >= 1, `capability ${cap} missing from corpus`);
  }

  assert(SEMANTIC_ASSERTION_CLASSES.length === 12, 'expected 12 assertion classes');
  assert(CORE_SEMANTIC_GATES.length >= 8, 'core gates too short');
  assert(HUMAN_QUALITY_FLOOR.average_min === 3.0, 'human quality floor drift');

  const dryRun = runCorpusCiDryRun({
    seed,
    minTurns: MIN_EXPANDED_EVALUATED_TURNS,
    corpusDir,
  });

  const evalLib = path.join(__dirname, '../lib/phase34-semantic-evaluation.mjs');
  const corpusLib = path.join(__dirname, '../lib/phase34-semantic-corpus.mjs');

  console.log(
    JSON.stringify(
      {
        ok: true,
        verifier: 'verify-phase34-semantic-evaluation',
        corpus_version: CORPUS_VERSION,
        compact_evaluated_turn_count: dryRun.compact_evaluated_turn_count,
        expanded_evaluated_turn_count: dryRun.expanded_evaluated_turn_count,
        session_count: dryRun.session_count,
        evaluation_status: dryRun.evaluation_status,
        expand_seed: seed,
        assertion_classes: SEMANTIC_ASSERTION_CLASSES.length,
        core_gates: CORE_SEMANTIC_GATES,
        human_quality_floor: HUMAN_QUALITY_FLOOR,
        capability_session_counts: sessionCounts,
        semantic_eval_lib_hash: sha256File(evalLib),
        semantic_corpus_lib_hash: sha256File(corpusLib),
        compact_corpus_hash: sha256File(compactPath),
        attempt_7: 'NOT_LAUNCHED',
        screenshots: 'NOT_CREATED',
        h1_h2_h3: 'transport_only',
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
        code: err.code || 'PHASE34_SEMANTIC_EVAL_VERIFY_FAIL',
        failed_sample: err.evaluation?.results?.filter((r) => r.status === 'FAIL')?.slice(0, 5),
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
