# Phase E — Real RAG, analytics, synthesis, actions

**Status:** Implemented on `main` (libraries + unit tests).
**Non-goals:** Attempt 7, screenshots, UI polish, live owner-proof PASS.
**MODEL_WEIGHT_TRAINING:** NO

## Pipeline

```text
planQuery
→ retrieve / retrieveForPlan
→ buildPlatformEvidenceSnapshot
→ deterministic analyze (caller or default calc helpers)
→ synthesizeGrounded (deterministic-only without gateway)
→ invention guard (+ retry-once → deterministic fallback)
→ claim ledger
→ finalizeCapabilityResponse envelope
```

Entry point: `runIntelligencePipeline()` in `scripts/lib/phase34-intelligence-pipeline.mjs`.

## Modules

| ID | File | Role |
|----|------|------|
| E1 | `phase34-query-planner.mjs` | Structured plan: capability, goals, subject, constraints, evidence types, time range, retrieval modes, calculations, tools, response depth; compound + follow-up via session facts |
| E2 | `phase34-retrieval.mjs` | Separated stores; exact / keyword (BM25-ish) / vector stub / hybrid RRF; honest `executed_mode` |
| E3 | `phase34-deterministic-analytics.mjs` | Shared `calc:median`, `calc:count`, `calc:percent_change` helpers |
| E4 | `phase34-grounded-synthesis.mjs` | Schema-validated synthesis; tiers; deterministic prose from structured_result only |
| E5 | `phase34-invention-guard.mjs` | Fail-closed numeric/currency/pressing/excluded-event checks; retry + fallback |
| E6 | `phase34-action-tools.mjs` | Typed tools with authz, dry-run, confirm, idempotency, audit; insert ≠ send |
| E7 | `phase34-intelligence-pipeline.mjs` | Wires E1–E5 into envelope |

Capability engines (scarcity / valuation / auction / recs / analytics) remain the owners of domain math; E3 only shares primitives for claim-ledger `calc:*` IDs.

## Hybrid honesty

Requesting `hybrid` without a vector index sets:

- `executed_mode`: `keyword_only_vector_unavailable` (not `hybrid`)
- `fallback_reason`: `VECTOR_INDEX_UNAVAILABLE`
- `vector_executed`: `false`

Static keyword reorder is never reported as hybrid.

## Tests

`tests/phase34-phase-e-pipeline.test.mjs` — planner, hybrid honesty, deterministic no-invention, invention fail-closed, action confirmation, empty-evidence honest limit E2E.

## Gaps (explicit)

1. **No live model gateway** — `low-latency` / `high-quality` / `privacy-local` fall back to deterministic-only with `MODEL_GATEWAY_UNAVAILABLE_FOR_TIER:*`.
2. **No production vector index** — vector/hybrid paths need an injected `vectorSearch` / `vectorIndex.search`; default is honest stub.
3. **Action tools are in-memory** — audit/idempotency/runtime are local; not yet wired to shopping-service / Postgres.
4. **Capability engines not auto-invoked** — callers pass `analyze` or `structured_result` / `candidates`; default analyzer only does median/count over snapshot sold rows.
5. Phase F semantic evaluation is implemented (`PHASE_F_SEMANTIC_EVAL.md`); Phase G real-data posture is implemented (`PHASE_G_RIGHTS.md`).
