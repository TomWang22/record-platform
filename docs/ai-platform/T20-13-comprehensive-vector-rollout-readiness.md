# T20.13 — Comprehensive vector rollout readiness re-eval

**Status:** READ-ONLY — post–Tranche 12 / ≥10k count gate  
**Generated:** 2026-06-26  
**Baseline SHA:** verify at commit time  
**Embedded:** 10,065 (~13.8% of 73,043 non-message chunks)  
**Mode:** no vector default flip, no Phase 21, no overlap flags default-on

## Executive verdict

**Production vector default: NOT APPROVED**

The **≥10k embedded count gate clears** at 10,065. Rollout remains blocked: coverage below 15%, shadow latency above SLO, shadow–keyword overlap fails, and zero-result shadow runs remain elevated.

## Gate table

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Embedded count | ≥10,000 | **10,065** | **PASS** |
| Embedded coverage | ≥15% non-message **or** ≥10k | **13.8%** / 10,065 | **PARTIAL** (count PASS; % FAIL) |
| Source diversity | ≥5 types in shadow weighted | **5–6** types when prompts succeed | **PASS** |
| Owner-visible OBO (e2e-contract) | ≥10 embedded chunks | **18** / 1,544 total OBO | **PASS** |
| Shadow p95 latency | ≤3,000 ms | **6,457 ms** (eval); **2,925 ms** (pre-write) | **FAIL** / **CONDITIONAL** |
| Embed p95 / timeouts | stable, no timeouts | p95 **3,297 ms**; 1 live-inference embed timeout | **CONDITIONAL** |
| Default/off overlap | meaningful parity | **15/16** zero (timing); **1/7** live inference | **FAIL** |
| Flagged/on overlap | diagnostic improvement only | **3/7** live inference | **FAIL** for rollout |
| Zero-result shadow runs | minimal | **8/16** | **FAIL** |
| Leakage | 0 | wrong_dim=0, message_embeddings=0, proxy_leaks=0 | **PASS** |
| Keyword stability | unchanged | 7/7 keyword cases; contract prompts stable | **PASS** |
| Endpoint contracts | audits PASS | RAG/runtime/endpoints/provider/pgvector PASS | **PASS** |
| Live inference quality | grounded keyword answers | 7/7 non-empty, leakage PASS, rule-engine | **PASS** |
| Tranche rerun guard | exit 2 on lock | Tranche 2–12 verified | **PASS** |
| Rollback readiness | keyword default, flags off | `AI_RAG_SHADOW_VECTOR=0`, overlap flags 0/0 | **PASS** |

## Corpus snapshot (post–Tranche 12)

| source_type | embedded |
|-------------|--------:|
| listing | 4,024 |
| listing_revision | 2,100 |
| notification | 1,550 |
| obo_offer_summary | 1,544 |
| record | 594 |
| auction_bid_summary | 253 |
| **Total** | **10,065** |

**Tranche 12 delta:** +500 (9,565 → 10,065). Lock: `bench_logs/ai-platform/t20-tranche-12-actual-run.json` (local, uncommitted).

## Live inference evidence

Artifact (local): `bench_logs/ai-platform/live-inference/20260626-125155.md`

| Check | Result |
|-------|--------|
| Keyword cases | 7/7 non-empty |
| Structured endpoints | 5/6 |
| Production `model_used` | `rule-engine` |
| Default shadow overlap | 1/7 |
| Flagged shadow overlap | 3/7 |
| Leakage | PASS |
| Flags after run | `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0` |

## Shadow timing evidence

Pre-write: `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-123033.md` — p95 **2,925 ms**, 0 timeouts, 11/16 zero-overlap  
Post-write eval: `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-125154.md` — p95 **6,457 ms**, 0 harness timeouts, 15/16 zero-overlap, 8/16 zero-result

Post-write source diagnostic (`t19-6-route-shadow-quality.md`) reported **FAIL** (12 issues): transient request failures on `listing_quality`, `notifications`, and `auction_risk` contract prompts during validation window. Pre-write diagnostic **PASS** (0 issues). Treat shadow diagnostic stability as **CONDITIONAL**.

## Product configuration (unchanged)

| Setting | Value |
|---------|-------|
| Production retrieval | **keyword** |
| `AI_RAG_SHADOW_VECTOR` default | `0` |
| Overlap flags default | **off** |
| `EMBEDDING_BACKFILL_FORCE` | not used |
| Phase 21 | **not started** |

## Rollback requirements (if rollout were attempted — not approved)

1. Keep `AI_RAG_SHADOW_VECTOR=0` in deployment.
2. Keep `AI_RAG_SHADOW_ENTITY_HINTS=0` and `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`.
3. Do not change keyword ranking or API contracts.
4. Tranche locks remain; no `EMBEDDING_BACKFILL_FORCE=1`.
5. Restore from latest preflight backup if corpus corruption suspected: `backups/rp-all-11-t20-12-tranche12-preflight/` (local).

## Recommended next steps (do not auto-start)

| Priority | Action |
|----------|--------|
| 1 | **Hold** vector default — rollout **NOT APPROVED** |
| 2 | Optional shadow-only refinement (read-only diagnostics) — explicit approval only |
| 3 | **T20.14/T20.15** production vector flip — only after **all** gates PASS + explicit approval |
| 4 | **Phase 21** — not started; blocked until rollout approved |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production keyword retrieval remains the default.
Phase 21 is not started.
Embedding ladder to 10k count gate: COMPLETE.
```
