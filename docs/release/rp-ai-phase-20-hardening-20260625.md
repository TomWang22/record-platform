# Record Platform AI Phase 20 hardening — release note draft

Generated: 2026-06-25  
Edge: `https://record-platform.test` (strict TLS only)

## Release identity

| Field | Value |
|-------|-------|
| Closeout SHA (T20.16/T20.17 era) | `967d877` |
| Phase | **20 — AI/RAG hardening and shadow diagnostics** |
| Phase 19 | **LOCKED** — `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| Phase 21 | **Not started** |
| Prepared tag (not created unless asked) | `rp-ai-phase-20-hardening-20260625` |

---

## Summary

Phase 20 hardened the AI/RAG platform but **did not approve vector rollout**.

- **Production retrieval remains keyword.** Vector retrieval remains shadow/diagnostic only.
- **`AI_RAG_SHADOW_VECTOR=0`** — unchanged.
- **Overlap refinement flags remain default off:**
  - `AI_RAG_SHADOW_ENTITY_HINTS=0`
  - `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`
- **Phase 21 is not started.**

Phase 20 delivered CI/coverage gates, bounded embedding growth with tranche safety, multiple read-only rollout evaluations, shadow latency/fetch hardening, and a closed T20.10 overlap/latency diagnostic branch. Keyword product behavior, API contracts, and production env defaults were not changed.

**Source of truth for agents:** `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`

---

## Completed work

### 1. Coverage hardening (T20.6)

| Item | Detail |
|------|--------|
| Ticket | **T20.6** (`655ffee`) |
| Manifest | `scripts/coverage/service-coverage-manifest.json` |
| Runner / enforcer | `scripts/coverage/run-service-coverage.sh`, `enforce-service-coverage.mjs` |
| Strict gate | `python-ai-service` only — `app/ai/*` ≥**90%** line coverage |
| CI | `.github/workflows/coverage.yml` (separate from product `ci.yml`) |
| Other services | `strict_enabled=false` until wired (T20.11 track) |

Phase 20 established a repeatable pytest-cov gate on the AI module without changing retrieval behavior.

### 2. Embedding tranche safety (T20.7 / T20.7R)

| Item | Detail |
|------|--------|
| **T20.7** | Bounded **Tranche 2**: +500 embeddings (4,549 → 5,049). Per-type caps; backup before run |
| **T20.7R** | Rerun guard hardening — locked tranche blocks with **exit 2**; `--check-lock`; smoke script |
| **T20.9 era** | Tranche 3 dry-run plan only (`docs/ai-platform/T20-9-tranche3-dry-run-plan.md`) — no broad write without approval |
| **Embedded total (Phase 20 closeout)** | **5,565** chunks (~**7.62%** of 73,043 non-message chunks) |
| Broad/full backfill | **Not performed** |
| `EMBEDDING_BACKFILL_FORCE=1` | **Not used** in Phase 20 closeout path |

Script: `scripts/rp-ai-embedding-backfill-controlled.sh` — exit `0` success · `1` failure · `2` lock blocked.

### 3. Readiness evaluations (read-only)

| Ticket | SHA | Verdict |
|--------|-----|---------|
| **T20.8** | `3aba170` | Vector rollout **NOT READY** — `docs/ai-platform/T20-8-vector-rollout-readiness.md` |
| **T20.10O** | `16d4d43` | Post notification-metadata refresh eval — rollout **NOT APPROVED** |
| **T20.10Z** | `26eb884` | Post shadow-refinement re-eval — rollout **NOT APPROVED** (diversity/latency improved; coverage/overlap still fail) |

These tickets evaluated gates only. No production vector default flip, no keyword ranking changes.

### 4. Shadow latency and fetch hardening (T20.10P–Y)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.10P** | `8ecfb94` | Shadow latency diagnostics (`candidate_fetch_ms`, `embed_ms`, rerank breakdown) |
| **T20.10T** | `02e80cb` | Real-query shadow timing harness; Ollama warmup gate; benchmark summary hardening |
| **T20.10U** | `3ec10eb` | pgvector candidate-fetch EXPLAIN — exact-sort diagnosis (no ANN index in Phase 20) |
| **T20.10V** | `ad0cd22` | Shadow profile refinement proposal (design) |
| **T20.10W** | `b7e17b6` / `c838cda` | Scoped-first + dedupe shadow fetch strategy |
| **T20.10X** | `8e5513d` | Source diversity regression diagnostics |
| **T20.10Y** | `3e2a80f` / `31d300f` | Typed diversity top-ups — restored **6** source types in shadow |

Outcome: shadow fetch path is more observable and diversity-aware. Latency improved on warm runs but remains historically unstable across runs.

### 5. Shadow overlap diagnostics (T20.10AA–AG)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.10AA** | `37071f8` / `b44f27a` | Shadow–keyword overlap deep dive; zero-overlap count correction |
| **T20.10AB** | `2d7b3af` | Overlap refinement proposal (Options A+C recommended) |
| **T20.10AC** | `4bcbf51` | Default-off flagged overlap refinements (entity hints + neighbor expansion) |
| **T20.10AD** | `0f42c06` | Flagged overlap eval — **11/16 → 8/16** zero-overlap when flags on |
| **T20.10AE** | `8468921` | Flagged latency-trim proposal (AF1–AF3) |
| **T20.10AF** | `dc8cff4` / `0a4634c` | Flagged latency trims implemented (entity-gated neighbors, reduced caps, conditional listing fetch) |
| **T20.10AG** | `40fabfc` | Stability re-eval — **8/16** zero-overlap on **3/3** flagged warm runs; branch **closed** |

**Important:** T20.10AC–AG improvements are **diagnostic-only**. They improve overlap from **11/16** to **8/16** zero chunk-overlap under explicitly enabled flags. They are **not** production rollout approval and **must not** be enabled by default.

### 6. Agent context refresh (T20.16)

| Ticket | SHA | Summary |
|--------|-----|---------|
| **T20.16** | `967d877` | Refreshed `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` with T20.10AG closeout state |

---

## Corpus snapshot (Phase 20 closeout)

| Metric | Value |
|--------|------:|
| Embedded chunks | **5,565** |
| Non-message chunks | **73,043** |
| Embedded coverage | **7.62%** |
| Weighted shadow source types | **6** (auction_bid_summary, listing, listing_revision, notification, obo_offer_summary, record) |
| e2e-contract owner-visible OBO embedded | **18** |
| python-ai `app/ai` coverage (strict) | **~90%+** PASS |

---

## Final gate state

| Gate | Target | Final Phase 20 state | Status |
|------|--------|----------------------|--------|
| Embedded coverage | ≥15% or ≥10k embedded | 7.62% / 5,565 | **FAIL** |
| Source diversity | ≥5 types | 6 | **PASS** |
| Owner-visible OBO | ≥10 | 18 | **PASS** |
| Shadow p95 latency | ≤3,000 ms | warm runs improved; unstable historically | **CONDITIONAL** |
| Embed p95 / timeouts | stable, no timeouts | unstable historically; T20.10AG flagged **0** timeouts | **CONDITIONAL** |
| Leakage | 0 | 0 | **PASS** |
| Keyword stability | unchanged | PASS | **PASS** |
| Shadow-keyword overlap | meaningful | default/off **11/16** zero; flagged/on **8/16** diagnostic-only | **FAIL** |
| Rerun guard | locked tranche exits 2 | PASS | **PASS** |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Production keyword retrieval remains the default.
Phase 21 is not started.
```

Phase 20 improved shadow observability, fetch strategy, diversity, and diagnostic overlap alignment. Rollout blockers remain: **embedded coverage**, **shadow–keyword overlap** (even flagged diagnostic mode does not reach parity), and **latency stability** under embed variance. No production behavior change was shipped for vector or overlap flags.

---

## What did not change

| Item | Phase 20 closeout state |
|------|-------------------------|
| Production retrieval | **keyword** |
| Vector default | **off** (`AI_RAG_SHADOW_VECTOR=0`) |
| Overlap flags default | **off** (`AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`) |
| Keyword ranking / API contracts | **unchanged** |
| Broad embedding backfill | **not performed** |
| ANN / vector index | **not added** |
| Phase 21 | **not started** |

---

## Next possible work (guarded)

1. **T20.12** — Tranche 12 actual completed (`t20-tranche-12`, +500 → 10,065 embedded). **≥10k count gate clears.**
2. **T20.13** — comprehensive rollout re-eval complete — rollout **NOT APPROVED**.
3. **No T20.14/T20.15** rollout until all gates pass.
4. **Phase 21** — not started.

Do not start T20.14/T20.15 rollout or Phase 21 without explicit approval and all gates passing.

---

## Key references

| Document | Path |
|----------|------|
| Phase 20 agent context | `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md` |
| T20.8 rollout eval | `docs/ai-platform/T20-8-vector-rollout-readiness.md` |
| T20.10Z post-refinement eval | `docs/ai-platform/T20-10Z-post-shadow-refinement-readiness.md` |
| T20.10AG stability eval | `docs/ai-platform/T20-10AG-flagged-overlap-stability-eval.md` |
| Phase 19 release | `docs/release/rp-ai-vector-shadow-routing-readiness-20260616.md` |
| Tranche 3 dry-run plan | `docs/ai-platform/T20-9-tranche3-dry-run-plan.md` |
| Coverage manifest | `scripts/coverage/service-coverage-manifest.json` |

---

## Verification commands (reference)

```bash
bash scripts/rp-ai-live-inference-transcript.sh   # T20.13C+ harness; optional embed warmup flags
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-ai-backfill-rerun-guard-smoke.sh
bash scripts/rp-och-decontaminate-scan.sh
```

Benchmark harness (read-only; artifacts stay local):

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
```

---

## Post-closeout addendum (T20.13K, 2026-06-26)

| Item | State |
|------|-------|
| Embedded | **10,065** — ≥10k **PASS** |
| Keyword RAG quality | **2.6 → 3.6/5** via `rag_synthesis.py` |
| Production | keyword / rule-engine |
| Vector rollout | **NOT APPROVED** — shadow p95 8–10s, overlap weak |
| Phase 21 | **not started** |
| Further tranches | Not required for 10k gate; 15% coverage only with explicit approval |

See `docs/ai-platform/T20-13K-post-synthesis-readiness-closeout.md` and updated `PHASE_20_COPILOT_CONTEXT.md`.
