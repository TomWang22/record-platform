# T20.8 — Vector rollout readiness evaluation (read-only)

**Generated:** 2026-06-22  
**Baseline SHA:** `8633149c6f8f74e351a19d82d92c08806902fce8`  
**Mode:** read-only — no embeddings, no product behavior changes, no vector default flip

## Executive verdict

**Production vector default: NOT READY**

Keyword retrieval remains the correct production default. Shadow vector diagnostics are healthy and improved post–Tranche 2, but T20.3 rollout thresholds are not met.

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Embedded coverage | ≥15% non-message **or** ≥10k embedded | **6.9%** (5,049 / 73,011) | **FAIL** |
| Source diversity (shadow weighted) | ≥5 types across contract prompts | **6 types** | **PASS** |
| Owner-visible OBO (e2e-contract) | ≥10 embedded chunks | **2** | **FAIL** |
| Shadow latency p95 | ≤3,000 ms | **~7,091 ms** | **FAIL** |
| Leakage (message/proxy/private) | 0 | **0** | **PASS** |
| Keyword stability | unchanged summaries/refs | all prompts stable | **PASS** |
| Shadow–keyword overlap | parity / meaningful overlap | **0** per prompt | **FAIL** |
| Coverage gate (python-ai) | ≥90% `app/ai/*` | **90.39%** | **PASS** |
| Tranche rerun guard | exit 2 on lock | verified T20.7R | **PASS** |

## Corpus snapshot (post T20.7 Tranche 2)

| source_type | embedded | unembedded | total |
|-------------|--------:|-----------:|------:|
| notification | 750 | 54,701 | 55,451 |
| listing | 1,700 | 7,618 | 9,318 |
| listing_revision | 800 | 5,083 | 5,883 |
| obo_offer_summary | 952 | 560 | 1,512 |
| record | 594 | 0 | 594 |
| auction_bid_summary | 253 | 0 | 253 |
| **Total (non-message)** | **5,049** | **67,962** | **73,011** |

**Tranche 2 delta:** +500 embeddings (4,549 → 5,049). Lock: `bench_logs/ai-platform/t20-tranche-2-actual-run.json`.

## Shadow quality (T19.6C diagnostic, read-only rerun)

- **RESULT:** PASS (0 issues)
- **Unweighted types:** auction_bid_summary, listing, listing_revision
- **Weighted / hinted types:** all 6 shadow-allowed types
- **Latency p50/p95 (hinted):** 4,316 / 7,091 ms (improved vs Phase 19 closeout ~11s / ~23s, still above 3s SLO)
- **Keyword overlap:** 0 per prompt (shadow complements keyword; not rollout-ready parity)
- **OBO owner-visible (e2e-contract):** 2 / 952 embedded OBO

## Product configuration (unchanged)

| Setting | Value |
|---------|-------|
| `AI_RAG_SHADOW_VECTOR` default | `0` (off) |
| Production retrieval | **keyword** (`retrieve_chunks`) |
| Vector path | shadow/diagnostic only (`retrieve_chunks_vector_shadow`, opt-in query params) |
| `EMBEDDING_BACKFILL_FORCE` | not used |

## Safety SQL (read-only)

| Check | Count |
|-------|------:|
| wrong_dim (≠768) | 0 |
| message_embeddings | 0 |
| proxy_leaks | 0 (script gate) |

## What improved since Phase 19 closeout

1. **T20.6** — coverage manifest, python-ai 90%+ gate, separate `coverage.yml` CI
2. **T20.7** — bounded Tranche 2 (+500 embeddings, caps honored)
3. **T20.7R** — tranche lock exits **2**; smoke proves blocked rerun without FORCE
4. Shadow p95 latency roughly **3× better** than closeout (~23s → ~7s) but still above rollout SLO

## Recommended next steps (do not auto-start)

| Priority | Ticket | Scope |
|----------|--------|-------|
| 1 | **Hold** | Do **not** enable vector default |
| 2 | Optional | Another bounded tranche **only** with backup + caps (not broad backfill) |
| 3 | Optional | Shadow ranking refinement (read-only / opt-in diagnostics) |
| 4 | Future | Production vector rollout only after **all** T20.3 thresholds pass + explicit approval |

## References

- Planning fork: `bench_logs/ai-platform/phase-20-next-step-planning.md`
- Phase 19 lock: `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md`
- Copilot context: `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`
- Shadow diagnostic: `scripts/rp-ai-shadow-source-diagnostic.sh`
- Controlled backfill: `scripts/rp-ai-embedding-backfill-controlled.sh`
- Rerun guard smoke: `scripts/rp-ai-backfill-rerun-guard-smoke.sh`

**RESULT: T20.8 evaluation complete — vector rollout NOT APPROVED**
