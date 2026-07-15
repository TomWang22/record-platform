# Phase 33 — Intelligence Capability Gauntlet

```text
Status: PHASE 33A–33C PACKAGES COMPLETE — LIVE GAUNTLET NOT LAUNCHED
Phase 33D–33G: NOT LAUNCHED
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

- Capability matrix: `scripts/ai-platform/intelligence-capability-matrix.json`
- Data-source lineage: `scripts/ai-platform/data-source-lineage.json`
- Retrieval corpus: `scripts/ai-platform/retrieval-corpus/`
- Phase 33C scenarios: `scripts/ai-platform/phase33c-scenarios/`
- Phase 33C policy: `scripts/ai-platform/phase33c-acceptance-policy.json`
- Verify:
  - `make ai-platform-verify-phase33a-contracts`
  - `make ai-platform-verify-phase33b`
  - `make ai-platform-verify-phase33c`
  - `make ai-platform-evaluate-phase33c-fixtures` (`/tmp` only)

## Selected Phase 33C routes

| Route | Module |
| --- | --- |
| `POST /ai/intelligence/scarcity` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/valuation` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/auction` | `app.ai.market_intelligence` |
| `POST /ai/intelligence/auction/watchlist-temperature` | `app.ai.market_intelligence` |

Legacy RAG routes (`/ai/records/valuation`, `/ai/auctions/risk`, etc.) remain
and are not replaced.

## Program phases

| Phase | Focus | Status |
| --- | --- | --- |
| 33A | Capability contracts and output schemas | COMPLETE |
| 33B | Data lineage, embeddings, retrieval evaluation corpus | COMPLETE (offline) |
| 33C | Scarcity, valuation, auction intelligence | COMPLETE (offline/fixture) |
| 33D | Negotiation assistance and recommendations | NOT LAUNCHED |
| 33E | Market analytics and multi-turn recall | NOT LAUNCHED |
| 33F | Cross-protocol capability gauntlet | NOT LAUNCHED |
| 33G | Targeted remediation and staging decision | NOT LAUNCHED |

## Phase 33B metric interpretation (not acceptance)

| Mode | Recall@5 | MRR | nDCG@5 |
| --- | ---: | ---: | ---: |
| keyword | 0.532 | 0.413 | 0.419 |
| semantic_fixture | 0.137 | 0.079 | 0.083 |
| hybrid_fixture | 0.564 | 0.401 | 0.389 |

These are development baselines. They are **not** production acceptance.
`semantic_fixture` is materially below an acceptable product-retrieval level.
Hybrid does **not** justify a production-default change. Phase 33C defaults to
deterministic metadata/keyword evidence selection.

## Phase 33C notes

- Structured envelope with evidence, confidence, limitations, abstention
- Deterministic scoring / authorization / currency math in code
- Model may only summarize after structured facts are validated
- Embedding generation and prompt tuning are not model-weight training

## Hard stops

- Production default remains keyword; PERCENT=0; ALLOW_PROD_PERCENT=0
- Hybrid/vector production default remains NOT ENABLED
- No live product matrix in CI
- No `/tmp` generated reports committed

## Next action

Owner review of Phase 33C implementation and evidence-grounding behavior, then
explicit approval for Phase 33D negotiation assistance and recommendations.
