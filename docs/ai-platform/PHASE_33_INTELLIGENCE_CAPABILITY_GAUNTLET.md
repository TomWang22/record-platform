# Phase 33 — Intelligence Capability Gauntlet

```text
Status: PHASE 33A + 33B PACKAGES COMPLETE — LIVE GAUNTLET NOT LAUNCHED
Phase 33C–33G: NOT LAUNCHED
Requires: separate owner approval before any executable product sub-phase
```

## Purpose

Prove eight intelligence capabilities with grounded evidence and cross-protocol
parity. Phase 32H remains the transport/runtime prerequisite and does not accept
product capabilities.

Phase 32H closeout: COMPLETE transport/runtime PASS for both arms;
causal verdict `NO_CAUSAL_SEPARATION`; underlying historical ≥60s cause
`UNRESOLVED`. See `docs/ai-platform/PHASE_32H_R1_CLOSEOUT.md`.

## Canonical sources

- Capability matrix:
  `scripts/ai-platform/intelligence-capability-matrix.json`
- Output schemas:
  `scripts/ai-platform/intelligence-output-schemas/`
- Data-source lineage:
  `scripts/ai-platform/data-source-lineage.json`
- Retrieval corpus:
  `scripts/ai-platform/retrieval-corpus/`
- Retrieval acceptance policy:
  `scripts/ai-platform/retrieval-acceptance-policy.json`
- Scenario preview (inventory only):
  `scripts/ai-platform/fixtures/scenario-preview/scenario-preview.json`
- Verify:
  - `make ai-platform-verify-phase33a-contracts`
  - `make ai-platform-verify-phase33b`
  - `make ai-platform-evaluate-phase33b-retrieval-fixtures` (writes `/tmp` only)

## Program phases

| Phase | Focus | Status |
| --- | --- | --- |
| 33A | Capability contracts and output schemas | COMPLETE |
| 33B | Data lineage, embeddings, retrieval evaluation corpus | COMPLETE (offline) |
| 33C | Scarcity, valuation, auction intelligence | NOT LAUNCHED |
| 33D | Negotiation assistance and recommendations | NOT LAUNCHED |
| 33E | Market analytics and multi-turn recall | NOT LAUNCHED |
| 33F | Cross-protocol capability gauntlet | NOT LAUNCHED |
| 33G | Targeted remediation and staging decision | NOT LAUNCHED |

## Phase 33B deliverables

- Machine-readable data-source inventory with privacy/auth/deletion lineage
- Embedding lineage record schema + tiny synthetic fixture vectors
- Development-band sanitized retrieval corpus (queries/documents/judgments/hard negatives)
- Negotiation-thread and auction-watchlist support fixtures (synthetic)
- Offline keyword / semantic_fixture / hybrid_fixture evaluator and metrics
- Deletion/freshness/privacy isolation hard stops
- Reports under `/tmp/phase33b-*` only (never committed)

Phase 33B is **not** product acceptance and does not authorize production
embedding writes, DB migrations, nonzero canary percents, or the live gauntlet.

## Hard stops

- Production default remains keyword; PERCENT=0; ALLOW_PROD_PERCENT=0
- Hybrid/vector production default remains NOT ENABLED
- No live product matrix in CI
- No `/tmp` generated reports committed
- Embedding generation is not model training
- No unsupported “model was trained” claims without weight-update artifacts

## Next action

Owner review of Phase 33B corpus and metrics, then explicit approval for
Phase 33C scarcity, valuation, and auction-intelligence implementation.
