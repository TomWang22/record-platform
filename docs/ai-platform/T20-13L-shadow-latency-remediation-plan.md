# T20.13L — Shadow latency remediation plan

**Status:** Read-only design + warmed telemetry analysis  
**Generated:** 2026-06-27  
**Baseline SHA:** `40bb4c1`  
**Embedded:** 10,065 (~13.8%)  
**Rollout SLO:** shadow p95 ≤ **3,000 ms** → **FAIL**

---

## Context

T20.13E/F embed warmup eliminated harness cold-start noise (`embed_timeout_before_fetch` 7/7 → 0/7). T20.13I/J improved keyword product quality (3.6/5) without touching shadow latency. This doc plans the engineering runway to bring shadow p95 under rollout SLO so T20.14/T20.15 can be evaluated.

**This is not rollout. This is not Phase 21.**

---

## Artifacts analyzed (local, not committed)

| Artifact | Path |
|----------|------|
| Live inference summary | `bench_logs/ai-platform/live-inference/20260626-223101.summary.json` |
| Live inference report | `bench_logs/ai-platform/live-inference/20260626-223101.md` |
| Canonical shadow timing | `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-223708.jsonl` |
| Canonical timing report | `bench_logs/ai-platform/t20-10-shadow-real-query-20260626-223708.md` |
| Prior triage | `docs/ai-platform/T20-13G-shadow-fetch-latency-overlap-triage.md` |
| Post-warmup baseline | `docs/ai-platform/T20-13F-post-warmup-inference-telemetry.md` |
| Synthesis eval | `docs/ai-platform/T20-13J-keyword-synthesis-quality-eval.md` |
| pgvector readiness | `bench_logs/ai-platform/phase-18-pgvector-readiness.md` — **PASS** |
| OCH decontaminate | **PASS** (590 files scanned) |

**Harness commands (T20.13L run):**

```bash
bash scripts/rp-ai-live-inference-transcript.sh \
  --embed-warmup-runs 3 --embed-warmup-threshold-ms 2000 --embed-retry-on-timeout 1

BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh
```

Warmup gate passed (3/3). One embed retry attempted/succeeded during live inference.

---

## Latency baseline

### Aggregate p50 / p95 (ms)

| Phase | Source | total p50/p95 | embed p50/p95 | candidate_fetch p50/p95 | rerank p50/p95 |
|-------|--------|--------------:|--------------:|------------------------:|---------------:|
| **Keyword production** | live inference | **1,462 / 2,302** | n/a | n/a | n/a |
| **Shadow flags off** | live inference | **3,636 / 6,057** | **954 / 2,885**† | **1,163 / 3,540** | n/a |
| **Shadow flags on** | live inference | **5,836 / 9,434** | n/a‡ | **2,579 / 6,715** | n/a |
| **Shadow (canonical)** | t20-10 timing | **1,476 / 6,926** | **730 / 4,915** | **627 / 1,865** | **2 / 11** |

† Computed from per-case embed_ms in live inference shadow-off table.  
‡ Flagged table reports total shadow_ms only; embed split not exported per case.

**Rollout gate:** shadow p95 ≤ 3,000 ms → **FAIL** on all warmed runs (6,057–9,434 ms live inference; 6,926 ms canonical).

Keyword production remains healthy (p95 ~2.3s). Rerank/select is negligible (<11 ms p95 canonical).

### Warmup variance (operational risk)

| Metric | T20.13J run | T20.13L run |
|--------|------------:|------------:|
| Warmup p50 ms | 1,767 | **1,176** |
| Warmup p95 ms | 25,149 | **25,121** |
| Embed retry attempted/succeeded | 2/1 | **1/1** |

Warmup gate passes on consecutive runs under 2s, but **p95 warmup spikes ~25s** persist — Ollama embed variance remains an operational blocker even when median is acceptable.

---

### Top 10 slow shadow cases (T20.13L live inference)

| Rank | case | mode | total_ms | embed_ms | cf_ms | latency class |
|-----:|------|------|--------:|---------:|------:|---------------|
| 1 | catalog_activity | flagged on | **9,434** | — | — | **mixed** (cf p95 elevated in flagged mode) |
| 2 | catalog_activity | flags off | **6,057** | 2,103 | 3,540 | **candidate_fetch_bound** |
| 3 | private_negotiation_no_messages | flagged on | **6,800** | — | — | **mixed** |
| 4 | seller_attention_today | flagged on | **6,672** | — | — | **mixed** |
| 5 | listing_revision_changes | flagged on | **5,836** | — | — | **mixed** |
| 6 | seller_notifications | flagged on | **5,813** | — | — | **mixed** |
| 7 | private_negotiation_no_messages | flags off | **4,230** | 2,885 | 1,147 | **embed_bound** |
| 8 | offer_bidding_activity | flags off | **3,718** | 735 | 2,877 | **candidate_fetch_bound** |
| 9 | listing_revision_changes | flags off | **3,636** | 1,726 | 1,628 | **mixed** |
| 10 | offer_bidding_activity | flagged on | **3,078** | — | — | **mixed** |

**Request errors:** 0 across all cases.

### Canonical timing — top total_ms (t20-10, warmed)

| profile | total_ms | embed_ms | cf_ms | latency class |
|---------|--------:|---------:|------:|---------------|
| shadow_default | **8,028** | 6,407 | 1,226 | **embed_bound** |
| obo_helper | **6,559** | 4,417 | 1,992 | **embed_bound** |
| obo_helper | 3,318 | 2,191 | 739 | **embed_bound** |
| shadow_default | 2,982 | 1,063 | 1,823 | **candidate_fetch_bound** |
| obo_helper | 1,918 | 838 | 979 | **mixed** |

One embed outlier ≥5s (`offer_bidding_activity` default mode: 6,407 ms embed). Zero embed timeouts across 16 canonical shadow runs.

### p95 root-cause classification

| Scope | Verdict | Rationale |
|-------|---------|-----------|
| Shadow flags **off** p95 | **`mixed`** | cf p95 (3,540 ms) > embed p95 (~2,885 ms); top slow case cf-dominant (`catalog_activity` cf=3,540) |
| Shadow flags **on** p95 | **`mixed`** | cf p95 (6,715 ms) >> off mode; entity-hint work expands fetch pool |
| Canonical shadow p95 | **`mixed`** | embed p95 4,915 ms + cf p95 1,865 ms; top runs embed-heavy (6.4–8.0s total) |
| Rerank | **negligible** | p95 ≤11 ms |
| Request errors | **0** | No `request_error` class in warmed runs |

**Summary:** Shadow p95 exceeds rollout target because **both Ollama embed variance and pgvector candidate_fetch cost** contribute. Warmup removed timeout noise but **did not** bring p95 under 3s. Flagged overlap mode **adds latency** (cf p95 6.7s) without being production-default.

---

## Remediation options

### Option A — Diagnostic warmup always on for shadow evals

| Aspect | Assessment |
|--------|------------|
| Status | **Already implemented** (T20.13E/F) |
| Effect | Eliminates 7/7 embed_timeout_before_fetch; unlocks overlap telemetry |
| Rollout value | **Insufficient alone** — p95 still 6–9s after warmup |
| Recommendation | **Keep in all diagnostic harnesses**; do not treat as production fix |

### Option B — Runtime/provider stabilization

Stabilize Ollama embedding service for production-adjacent shadow paths:

| Measure | Scope | Expected impact |
|---------|-------|-------------------|
| Pre-loaded `nomic-embed-text` model at pod start | Ollama + python-ai init | Reduce cold-start 25s p95 spikes |
| Readiness probe: embed under 2s × 3 consecutive | K8s deployment | Block traffic until warm |
| Dedicated embed worker / sidecar | Infra | Isolate embed from chat model contention |
| Resource limits + CPU/memory floor | Ollama deployment | Reduce eviction/reload |
| Keep-alive / periodic embed ping | Ollama service | Prevent model unload between requests |
| Embed timeout + single retry (production-safe) | python-ai-service config | Bounded tail without blocking fetch |

**Pros:** Addresses embed-bound top cases (6.4–8.0s canonical); fixes operational variance seen in warmup p95 spikes.  
**Cons:** Infra change; does not fix cf-bound cases alone.  
**Risk:** Low if scoped to provider readiness, not retrieval default change.

### Option C — Candidate fetch trim

Reduce exact-sort work on latency-sensitive shadow routes:

| Measure | Scope | Expected impact |
|---------|-------|-------------------|
| Stronger typed-first routing | `shadow_profiles.py` | Skip global fanout when intent is classified |
| Profile-specific fetch caps | seller_sales_summary, obo_helper | Lower `selected_count` ceiling on diagnostic routes |
| Avoid global fetch for strongly classified prompts | rag_retrieval.py (shadow only) | cf p95 reduction on catalog/revision cases |
| Limit diversity topups on latency-sensitive routes | shadow overlap refinements | Reduce cf on flagged mode (currently cf p95 6.7s) |
| Query-embedding cache | **benchmark/eval only** | Removes repeat embed cost in harness; not production |

**Pros:** Directly targets cf-bound cases (`catalog_activity` cf=3,540 ms off; revision cf=1,823 ms canonical).  
**Cons:** May reduce overlap further if pool shrinks — must re-measure in T20.13Q.  
**Risk:** Medium; shadow-only first, no production keyword change.

### Option D — ANN index proposal (ops ticket)

Design pgvector HNSW/IVFFlat index as separate ops-approved ticket:

| Item | Detail |
|------|--------|
| Current state | `embedding_vec vector(768)` present; **no ANN index** (exact sort at 10,065 rows) |
| pgvector readiness | **PASS** — extension installed, migration applied |
| Proposed ticket | Ops migration: HNSW on `embedding_vec` with cosine ops |
| Required artifacts | EXPLAIN ANALYZE before/after; backout migration; load test at 10k+ rows |
| Rollout gate | Index verified under shadow harness **before** any production default change |
| Default | **No index creation without explicit approval** |

**Pros:** Scales cf as corpus grows toward 15%; industry-standard fix.  
**Cons:** Ops coordination; recall tuning; not instant.  
**Risk:** Medium — index build time, recall vs latency tradeoff.

### Option E — Shadow result cache for diagnostics

Cache repeated benchmark queries only:

| Aspect | Detail |
|--------|--------|
| Scope | Harness / benchmark scripts only |
| Key | `(query_hash, profile, flags)` → shadow chunk IDs + timings |
| Production | **Not used** — diagnostic repeatability only |
| Effect | Stabilizes CI/benchmark variance; does not fix first-request latency |

**Pros:** Cheap; improves eval repeatability.  
**Cons:** Does not fix production or first-run shadow latency.  
**Recommendation:** Optional harness enhancement; not a rollout blocker fix.

---

## Recommendation

**Fastest path to p95 ≤3s (ordered):**

1. **B — Runtime/provider stabilization** (`T20.13O`) — first; embed p95 4.9s canonical and warmup spikes block every vector path
2. **C — Candidate fetch trim** (`T20.13P`) — second; cf p95 3.5s (off) / 6.7s (flagged) on live inference
3. **D — ANN index design** — separate ops ticket parallel to B; required before corpus growth to 15%
4. **A — Diagnostic warmup** — keep in all harnesses permanently
5. **E — Shadow cache** — optional harness polish; not on critical path

**Do not:** enable vector default, default-on overlap flags, embedding tranches, or Phase 21 from this plan.

---

## Implementation candidates

| Ticket | Scope | Type |
|--------|-------|------|
| **T20.13O** | Ollama embed readiness, keep-alive, bounded retry — diagnostic + provider infra | Implementation |
| **T20.13P** | Shadow-only candidate fetch trim / typed-first caps | Implementation |
| **T20.13Q** | Post-fix readiness re-eval (latency + overlap + answer quality) | Read-only eval |

**Recommended immediate next ticket:** **T20.13O** — latency stabilization blocks every vector path and flagged overlap work.

---

## Final verdict

```text
Vector rollout: NOT APPROVED
Phase 21 is not started
Production retrieval remains keyword
```
