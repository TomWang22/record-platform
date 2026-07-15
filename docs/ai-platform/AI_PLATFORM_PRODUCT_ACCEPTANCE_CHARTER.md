# AI Platform Product Acceptance Charter

```text
Status: OWNER REVIEW — PHASE 33A CONTRACTS ONLY
Phase 32H: COMPLETE (transport/runtime PASS; causal NO_CAUSAL_SEPARATION)
Phase 33: PLAN/CONTRACT WORK ONLY — NOT LAUNCHED
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
| Validator | `scripts/ai-platform/verify-intelligence-capability-contracts.mjs` |
| Make target | `make ai-platform-verify-phase33a-contracts` |

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
| 33A | Capability contracts and output schemas | contracts only |
| 33B | Data lineage, embeddings, retrieval corpus | NOT LAUNCHED |
| 33C | Scarcity, valuation, auction intelligence | NOT LAUNCHED |
| 33D | Negotiation assistance and recommendations | NOT LAUNCHED |
| 33E | Market analytics and multi-turn recall | NOT LAUNCHED |
| 33F | Cross-protocol capability gauntlet | NOT LAUNCHED |
| 33G | Remediation and staging decision | NOT LAUNCHED |

## Hard stops

- No production enablement from Phase 32H or Phase 33A alone
- No Phase 33B–33G workload without separate owner approval
- No automatic negotiation-message sending
- No private-message cross-user retrieval
- No unsupported market or valuation claims
- No committing `/tmp` generated capability-plan reports
