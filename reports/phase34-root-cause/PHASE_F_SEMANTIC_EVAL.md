# Phase F — Semantic product evaluation

**Status:** Implemented on `main` (libraries + compact corpus + unit tests + CI verifier).
**Non-goals:** Attempt 7, screenshots, UI polish, owner-proof PASS claims.
**H1/H2/H3:** Transport-only — never used as product truth in these gates.

## Goal

Replace shape-only / protocol success with claim↔evidence, correction, mode, session, invention, action, and honest-limit assertions **before** any future visual proof.

## Modules

| ID | File | Role |
|----|------|------|
| F1 | `scripts/lib/phase34-semantic-evaluation.mjs` | 12 assertion classes + dossier builder + human quality rubric |
| F2 | `scripts/lib/phase34-semantic-corpus.mjs` + `scripts/ai-platform/phase34-semantic-corpus/` | Compact multi-session corpus + `expandCorpus(seed)` → ≥500 turns |
| F3 | `buildSemanticResponseDossier()` | Per-response dossier with snapshot ids, included/excluded, calc, model hashes, ledger, gates, correction, action audit, descriptive latency |
| F4 | `scoreHumanQualityRubric()` | Deterministic heuristics; floor `average ≥ 3.0`, dim ≥ 2 |

## Assertion classes (F1)

1. `evidence_identity`
2. `eligibility_correctness`
3. `claim_to_evidence_support`
4. `rights_compliance`
5. `exact_vs_release`
6. `correction_recomputation`
7. `retrieval_mode_honesty`
8. `session_fact_authority`
9. `no_invention`
10. `action_safety`
11. `honest_limit_correctness`
12. `customer_language_quality`

**Core CI gates** omit soft/skip-heavy classes when empty (`correction_recomputation`, `session_fact_authority` still run when applicable on dossier fields; core list focuses on always-material gates — see `CORE_SEMANTIC_GATES`).

## Corpus (F2)

- Checked-in compact JSON: `scripts/ai-platform/phase34-semantic-corpus/compact-corpus.json`
- Manifest: `scripts/ai-platform/phase34-semantic-corpus/manifest.json`
- All **8** capabilities covered
- **≥10 sessions** for each customer-facing capability (embeddings fewer; diagnostic)
- Negotiation primary session includes: shipping change, condition, floor, tone, fabricate-leverage refuse, draft insert, cancel send, confirm send, memory correction, forget (+ accept/reject counters)
- Auction primary session includes: bid-history variation, watcher-rich bid-light, acceleration, clustered endings, underpriced/overheated, no-bid honest limit, 24h window correction
- `expandCorpus(seed)` deterministically expands compact → **≥500 evaluated turns** for CI

## Human quality floor (F4)

```text
HUMAN_QUALITY_FLOOR = { average_min: 3.0, dimension_min: 2, scale_max: 4 }
```

Dimensions: directness, completeness, usefulness, explanation, naturalness, correction_handling, uncertainty_honesty, actionability, technical_leakage, repetition.

## Tests / CI

```bash
node --test tests/phase34-semantic-evaluation.test.mjs
node scripts/ai-platform/verify-phase34-semantic-evaluation.mjs
```

## Explicit gaps

1. Rubric is **heuristic**, not human-rated collector gold.
2. Corpus dossiers are **fixtures** grounded to pass semantic gates — not live pipeline recapture.
3. Expansion clones compact turns with stable identity mutation; it does not simulate full live retrieval diversity.
4. Correction / session-authority gates SKIP when those fields are absent (non-conversational turns).
5. Phase G rights connectors are implemented (`PHASE_G_RIGHTS.md`); F does not enable Popsike/Gripsweat.
6. No attempt 7 / screenshot pack / owner visual PASS.

## Gate statement

Semantic assertions + expanded corpus CI dry-run are the product-evaluation gate. PNG hash differences remain **not** a correction proof.
