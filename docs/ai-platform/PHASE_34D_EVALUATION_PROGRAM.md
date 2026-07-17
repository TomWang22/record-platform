# Phase 34D — Evaluation program

```text
Status: SCAFFOLDING COMPLETE — FULL 20k HOLDOUT / HUMAN REVIEW NOT COMPLETE
MODEL_WEIGHT_TRAINING: NO
OPTIMIZATION: PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION
Target: /tmp/phase33f-capability-gauntlet-target-v1 — ABSENT / NOT LAUNCHED
Production: NOT APPROVED
```

## Artifacts

| Artifact | Path |
| --- | --- |
| Eval policy (owner floors) | `scripts/ai-platform/phase34-eval-policy.json` |
| Unique-session corpus generator | `scripts/ai-platform/generate-phase34-unique-session-corpus.mjs` |
| Retrieval/reranker tuning runner | `scripts/ai-platform/run-phase34-retrieval-tuning.mjs` |
| Multi-turn eval runner | `scripts/ai-platform/run-phase34-multiturn-eval.mjs` |
| Human-review package generator | `scripts/ai-platform/generate-phase34-human-review-package.mjs` |

All generated reports write under `/tmp/phase34-eval/` only.

## Session counting

Minimums (full mode): development ≥12,000; validation ≥4,000; frozen holdout ≥4,000; total unique logical ≥20,000.

Reports separately: logical sessions, model invocations, transport probes, conversation turns.

**H1/H2/H3 protocol copies are not unique logical sessions.**

## Floors (not lowered)

Frozen holdout retrieval: Recall@5 ≥0.60, Recall@10 ≥0.75, MRR ≥0.45, nDCG@5 ≥0.50, nDCG@10 ≥0.55, exact-pressing ≥0.75; leakage/deleted/wrong-scope/silent-fallback = 0.

Multi-turn: recall precision/recall ≥0.95; correction precedence / deletion propagation = 1.0; cross-thread/user leakage and false/stale-current memory claims = 0.

Capability acceptance floors live in `phase34-eval-policy.json` section `capability_acceptance_floors` (owner sections 9 + 11).

## Smoke commands

```bash
node scripts/ai-platform/generate-phase34-unique-session-corpus.mjs --smoke
node scripts/ai-platform/run-phase34-retrieval-tuning.mjs --smoke
node scripts/ai-platform/run-phase34-multiturn-eval.mjs --smoke
node scripts/ai-platform/generate-phase34-human-review-package.mjs --smoke
```
