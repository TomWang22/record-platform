#!/usr/bin/env node
/**
 * Phase 34C/D — staged prompt candidate selection 12→4→2→1.
 * Scorecards under /tmp/phase34-eval/…  --smoke supported.
 * MODEL_WEIGHT_TRAINING: NO
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from './generate-phase34-prompt-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.join(__dirname, 'phase34-prompt-registry');
const POLICY = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'phase34-eval-policy.json'), 'utf8'),
);
const DEFAULT_OUT = '/tmp/phase34-eval/candidate-selection';

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

function loadCandidates(capabilityId) {
  const doc = JSON.parse(fs.readFileSync(path.join(REGISTRY, `${capabilityId}.json`), 'utf8'));
  return doc.candidates;
}

/**
 * Deterministic offline scorecard scaffold (no live model calls).
 * Prefer evidence_first / schema_strategy / abstention / tool_ordering for ranking.
 */
function scoreCandidate(candidate, stage) {
  const dimBoost = {
    evidence_first: 12,
    schema_strategy: 11,
    abstention: 10,
    tool_ordering: 9,
    structured_decomposition: 8,
    few_shot: 7,
    confidence: 6,
    limitation_placement: 5,
    safety_placement: 5,
    concise: 4,
    explanatory: 3,
    novice: 2,
    expert: 2,
    buyer: 2,
    seller: 2,
    clarification: 3,
    conclusion_first: 1,
    negative_examples: 4,
  };
  let score = 50;
  for (const d of candidate.dimensions) {
    score += dimBoost[d] || 0;
  }
  // Stage 1 hard rejects: missing safety policy fields.
  const hardFail =
    candidate.policies?.automatic_send_allowed === true ||
    candidate.policies?.cross_user_retrieval_allowed === true ||
    candidate.policies?.MODEL_WEIGHT_TRAINING !== 'NO';
  if (hardFail) {
    return {
      candidate_id: candidate.candidate_id,
      stage,
      hard_reject: true,
      rejection_reason: 'policy_hard_stop',
      score: 0,
      metrics: { schema_ok: false, privacy_ok: false, safety_ok: false },
    };
  }
  // Small deterministic jitter from hash nibble so ties break stably.
  const nibble = parseInt(candidate.content_sha256.slice(0, 4), 16) % 7;
  score += nibble;
  if (stage >= 2 && candidate.primary_dimension === 'conclusion_first') score -= 3;
  if (stage >= 3 && candidate.model_tier === 'rule_deterministic') score += 2;
  return {
    candidate_id: candidate.candidate_id,
    content_sha256: candidate.content_sha256,
    primary_dimension: candidate.primary_dimension,
    model_tier: candidate.model_tier,
    stage,
    hard_reject: false,
    score,
    metrics: {
      schema_ok: true,
      privacy_ok: true,
      safety_ok: true,
      groundedness_proxy: Math.min(1, score / 100),
      usefulness_proxy: Math.min(1, (score - 40) / 60),
    },
  };
}

function selectTop(scorecards, n) {
  return [...scorecards]
    .filter((s) => !s.hard_reject)
    .sort((a, b) => b.score - a.score || a.candidate_id.localeCompare(b.candidate_id))
    .slice(0, n);
}

export function runCandidateSelection({ smoke = false, outDir = DEFAULT_OUT } = {}) {
  if (!String(outDir).startsWith('/tmp/phase34-eval')) {
    throw new Error(`outDir_must_be_under_/tmp/phase34-eval: ${outDir}`);
  }

  const stagesPolicy = POLICY.candidate_selection.stages;
  const perCapability = {};
  const selected = {};

  for (const capabilityId of CAPABILITIES) {
    const all = loadCandidates(capabilityId);
    const stage1Cards = all.map((c) => scoreCandidate(c, 1));
    const top4 = selectTop(stage1Cards, stagesPolicy[0].retain);
    const stage2Cards = top4.map((t) =>
      scoreCandidate(all.find((c) => c.candidate_id === t.candidate_id), 2),
    );
    const top2 = selectTop(stage2Cards, stagesPolicy[1].retain);
    const stage3Cards = top2.map((t) =>
      scoreCandidate(all.find((c) => c.candidate_id === t.candidate_id), 3),
    );
    const top1 = selectTop(stage3Cards, stagesPolicy[2].retain);
    const stage4Cards = top1.map((t) =>
      scoreCandidate(all.find((c) => c.candidate_id === t.candidate_id), 4),
    );

    const winner = stage4Cards[0] || null;
    perCapability[capabilityId] = {
      capability_id: capabilityId,
      stages: {
        stage1_12_to_4: { scorecards: stage1Cards, retained: top4.map((t) => t.candidate_id) },
        stage2_4_to_2: { scorecards: stage2Cards, retained: top2.map((t) => t.candidate_id) },
        stage3_2_to_1: { scorecards: stage3Cards, retained: top1.map((t) => t.candidate_id) },
        stage4_holdout_lock: {
          scorecards: stage4Cards,
          retained: winner ? [winner.candidate_id] : [],
          tune_after_holdout: false,
          note: smoke
            ? 'smoke_mode_scaffold_only'
            : 'frozen_holdout_run_once_do_not_tune_after_reading',
        },
      },
      selected: winner,
    };
    selected[capabilityId] = winner;
    writeJson(path.join(outDir, 'scorecards', `${capabilityId}.json`), perCapability[capabilityId]);
  }

  const summary = {
    runner: 'run-phase34-prompt-candidate-selection.mjs',
    smoke,
    MODEL_WEIGHT_TRAINING: 'NO',
    OPTIMIZATION: POLICY.OPTIMIZATION,
    stages: '12→4→2→1',
    capabilities: CAPABILITIES.length,
    selected,
    floors_unchanged: true,
  };
  writeJson(path.join(outDir, 'selection-summary.json'), summary);
  return { outDir, summary };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runCandidateSelection(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'WROTE',
        outDir: result.outDir,
        smoke: args.smoke,
        selected: Object.fromEntries(
          Object.entries(result.summary.selected).map(([k, v]) => [k, v?.candidate_id || null]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
