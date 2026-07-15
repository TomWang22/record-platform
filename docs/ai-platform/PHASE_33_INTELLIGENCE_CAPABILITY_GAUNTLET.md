# Phase 33 — Intelligence Capability Gauntlet

```text
Status: PHASE 33A CONTRACT PACKAGE — GAUNTLET NOT LAUNCHED
Phase 33B–33G: NOT LAUNCHED
Requires: separate owner approval before any executable sub-phase
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
- Scenario preview (inventory only):
  `scripts/ai-platform/fixtures/scenario-preview/scenario-preview.json`
- Verify:
  `make ai-platform-verify-phase33a-contracts`

## Program phases

| Phase | Focus | Status |
| --- | --- | --- |
| 33A | Capability contracts and output schemas | CONTRACT PACKAGE |
| 33B | Data lineage, embeddings, retrieval evaluation corpus | NOT LAUNCHED |
| 33C | Scarcity, valuation, auction intelligence | NOT LAUNCHED |
| 33D | Negotiation assistance and recommendations | NOT LAUNCHED |
| 33E | Market analytics and multi-turn recall | NOT LAUNCHED |
| 33F | Cross-protocol capability gauntlet | NOT LAUNCHED |
| 33G | Targeted remediation and staging decision | NOT LAUNCHED |

## Phase 33A deliverables

- Eight capability entries with implementation/test status (`partial`/`planned`,
  never falsely `accepted`)
- Draft 2020-12 schemas with `$id`, evidence/confidence/limitations
- Shared definitions (evidence-item, confidence, limitation, lineage, money,
  time-range)
- Embedding metadata + semantic-search contracts
- Negotiation hard safety (never auto-send)
- Auction watchlist-batch temperature fields
- Scenario-row schema + required scenario-class preview inventory
- Offline validator, Node tests, Make/CI wiring
- Training-terminology policy guard

## Prompting sessions

Phase 33A defines the scenario-row contract and a preview inventory. It does
**not** launch the gauntlet and does not commit generated transcripts as evidence.

Required scenario classes include buyer/seller, novice/experienced, common/rare,
exact/ambiguous pressing, strong/weak comparables, single/multi-turn, corrections,
contradictions, stale/missing/malformed data, overclaim and unsupported-valuation
traps, privacy and cross-user memory attempts, negotiation manipulation,
recommendation diversity, and auction-watchlist market-temperature cases.

## Projected matrix bands (planning only)

| Band | Approx probes | Est. runtime @ ~0.8 qps | Est. storage |
| --- | ---: | ---: | ---: |
| Low | ~5,760 | ~2 h | ~8 GiB |
| Target | ~17,280 | ~6 h | ~25 GiB |
| Soak | ~34,560 | ~12 h | ~45 GiB |

Exact size is an owner decision before any launch.

## Hard stops

- Production default remains keyword; PERCENT=0; ALLOW_PROD_PERCENT=0
- Hybrid/vector production default remains NOT ENABLED
- No live product matrix in CI
- No `/tmp` generated reports committed
- No unsupported “model was trained” claims without weight-update artifacts

## Next action

Owner review of Phase 33A contracts and explicit approval for the next executable
sub-phase (likely 33B).
