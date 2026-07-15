# AI Platform Product Acceptance Charter

```text
Status: OWNER REVIEW — PHASE 33C MARKET INTELLIGENCE PACKAGE
Phase 32H: COMPLETE (transport/runtime PASS; causal NO_CAUSAL_SEPARATION)
Phase 33A: COMPLETE
Phase 33B: COMPLETE (offline lineage + retrieval corpus; no production writes)
Phase 33C: COMPLETE (scarcity/valuation/auction engines; fixture-only)
Phase 33D–33G: NOT LAUNCHED
Production enablement: NOT APPROVED
Production default: keyword
PERCENT: 0
ALLOW_PROD_PERCENT: 0
Hybrid/vector production default: NOT ENABLED
```

## North star

The end goal is a **complete record-market AI intelligence platform**.

It is not merely a chatbot, and it is not complete when a generic RAG response
returns HTTP 200.

The platform must provide reusable structured intelligence services for:

1. scarcity
2. valuation
3. auction intelligence
4. embeddings
5. semantic search
6. negotiation assistance
7. recommendations
8. market analytics

Chat is only one presentation surface.

**Success definition:** the platform produced grounded, structured, useful,
privacy-safe market intelligence with verifiable evidence and consistent
protocol behavior.

## Canonical machine-readable contracts

| Artifact | Path |
| --- | --- |
| Capability matrix (canonical) | `scripts/ai-platform/intelligence-capability-matrix.json` |
| Output schemas | `scripts/ai-platform/intelligence-output-schemas/` |
| Scenario-row schema | `scripts/ai-platform/intelligence-output-schemas/scenario-row.schema.json` |
| Scenario preview inventory | `scripts/ai-platform/fixtures/scenario-preview/scenario-preview.json` |
| Data-source lineage | `scripts/ai-platform/data-source-lineage.json` |
| Retrieval corpus | `scripts/ai-platform/retrieval-corpus/` |
| Retrieval acceptance policy | `scripts/ai-platform/retrieval-acceptance-policy.json` |
| Phase 33A validator | `scripts/ai-platform/verify-intelligence-capability-contracts.mjs` |
| Phase 33B validators | `make ai-platform-verify-phase33b` |

Do not maintain a second capability matrix under `docs/`. Documentation links to
the canonical matrix above.

## Phase 32H closeout (honest)

| Field | Value |
| --- | --- |
| Status | COMPLETE |
| Transport/runtime | PASS for baseline-r9 and protected caffeinate-r1 |
| Causal verdict | `NO_CAUSAL_SEPARATION` |
| Underlying historical ≥60s cause | UNRESOLVED |
| Secondary | `FULL_SOAK_OR_ADDITIONAL_TARGETED_REPRO_REQUIRED` |
| Detail | `docs/ai-platform/PHASE_32H_R1_CLOSEOUT.md` |

Phase 32H does **not** prove the eight product capabilities and must not enable
production hybrid/vector defaults.

## Capability contracts

Phase 33A defines contracts and schemas. It does **not** claim capabilities are
fully implemented or accepted.

Every intelligence output schema requires `evidence`, `confidence`, and
`limitations`. Strict schemas use `additionalProperties: false`.

Multi-turn recall is a platform-wide evaluation dimension with
`memory-contract.schema.json`.

### Negotiation safety (hard)

- never auto-send
- never impersonate the user
- never fabricate leverage
- never claim counterparty intent as fact
- label inferred intent
- no discriminatory or coercive tactics
- no cross-user thread retrieval
- no secret/private field telemetry

### Auction intelligence

Supports single-auction and watchlist-batch market-temperature analysis.
Do not infer bidder identity, collusion, or manipulation without direct evidence.

## Training terminology

Do **not** say the model was trained unless weights were updated and supported by
approved dataset lineage, consent/privacy review, train/validation/test split,
holdout metrics, model artifact/version, reproducible configuration, safety
evaluation, and rollback plan.

Otherwise use: prompt design, few-shot configuration, retrieval tuning, chunking
tuning, embedding generation, reranker tuning, threshold calibration, schema
enforcement, evaluation, grounding improvement.

## Cross-protocol validation

Accepted capabilities must be validated across `http1`, `http2`, and `http3`.
Parity means equivalent conclusions, structured values, evidence, safety,
ranking/retrieval, and abstention — not byte-identical prose.

## Sequencing

| Phase | Focus | Launched |
| --- | --- | --- |
| 33A | Capability contracts and output schemas | COMPLETE (contracts only) |
| 33B | Data lineage, embeddings, retrieval corpus | COMPLETE (offline fixtures only) |
| 33C | Scarcity, valuation, auction intelligence | COMPLETE (offline/fixture engines) |
| 33D | Negotiation assistance and recommendations | COMPLETE (offline/fixture engines) |
| 33E | Market analytics and multi-turn recall | COMPLETE (fixture offline; durable private memory NOT AUTHORIZED) |
| 33F | Cross-protocol capability gauntlet | READINESS PACKAGE; CANARY BLOCKED pending semantic retrieval quality |
| 33G | Remediation and staging decision | NOT LAUNCHED |

## Hard stops

- No production enablement from Phase 32H or Phase 33A–33D alone
- No production embedding writes or DB migrations from Phase 33B/33C/33D
- Phase 33F canary requires offline quality READY (including semantic_fixture development floors); target 17280 requires a further separate approval
- No Phase 33G workload without separate owner approval
- No durable private-message memory or production analytics enablement without separate owner approval
- Semantic/hybrid retrieval remain non-default (Phase 33B baselines are not acceptance)
- No automatic negotiation-message sending
- No private-message cross-user retrieval
- No unsupported market or valuation claims
- No hidden pay-to-rank recommendations
- No committing `/tmp` generated capability-plan reports
