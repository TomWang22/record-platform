# T20.14C — Shadow latency implementation plan

**Status:** Read-only design — no implementation  
**Generated:** 2026-06-28  
**Baseline SHA:** `d1141e0`  
**Inputs:** T20.14A baseline, T20.13L/G triage, T20.10U EXPLAIN, fresh warm shadow run `20260628-140942`  
**Release context:** Phase 21 non-vector seller intelligence **RELEASE TAGGED** @ `d0e4c58` — does not approve vector rollout

---

## Executive summary

Shadow p95 (**9066 ms**) exceeds the rollout SLO (≤3000 ms) because latency is **mixed embed-bound and candidate_fetch-bound**. Rerank/select is negligible (p95 **15 ms**). One embed timeout caused the only zero-result shadow run (1/16). Production keyword path is unaffected and must remain unchanged.

**Recommended path:** T20.14D implements **Option A (embed stabilization)** plus **lightweight Option B (candidate fetch trim)** in shadow/diagnostic code only, then T20.14E 3-run re-eval. ANN index (Option D) and overlap v2 (Option E) are deferred until latency gates trend toward PASS.

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14D candidate-fetch/embed-stability implementation
```

---

## 1. Current latency profile

Source: `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-140942.md` (warm gate passed; `BENCH_REQUIRE_OLLAMA_WARM=1`, `BENCH_WARMUP_RUNS=1`).

| Metric | Current | Target | Status |
|--------|--------:|-------:|--------|
| shadow p95 | **9066 ms** | ≤3000 ms | **FAIL** |
| shadow p50 | 4531 ms | — | — |
| embed p95 | **5321 ms** | stable / no timeout | **FAIL** |
| embed p50 | 2666 ms | — | — |
| candidate_fetch p95 | **4671 ms** | ≤1500 ms preferred | **FAIL** |
| candidate_fetch p50 | 1696 ms | — | — |
| embed timeouts | **1** | 0 | **FAIL** |
| embed outliers ≥5s | **2** | 0 | **FAIL** |
| zero-result shadow | **1/16** | 0 | **FAIL** |
| rerank p95 | **15 ms** | low | **PASS** |
| rerank p50 | 6 ms | — | **PASS** |

**Keyword production (unchanged):** Playwright + contracts PASS; seller dashboard ready **3174 ms** on latest acceptance run.

**Out-of-scope for shadow latency lane:** Phase 21 product telemetry **1 WARN** (`ui_latency_p95_ms` 21064) — keyword UI tail on record-intelligence scenario 1; track separately on product lane, not a vector blocker fix.

---

## 2. Required analysis

### 2.1 Embed-bound vs candidate_fetch-bound

| Scope | Verdict | Evidence |
|-------|---------|----------|
| **Aggregate p95** | **Mixed (~50/50)** | embed p95 5321 ms + cf p95 4671 ms; sequential phases both contribute |
| **Tail total_ms** | **Mixed, cf-heavy on worst runs** | Top run: 11790 ms = embed 5168 + cf **6012**; #2: 8158 = embed 3775 + cf **4224** |
| **Warm embed, slow fetch** | **cf-only path exists** | Default mode, cache_hit=True: embed **7 ms**, cf **3328 ms** on same query |
| **Embed-only tail** | **Present** | Default OBO query: embed **5780 ms** timeout → cf 0, zero results |
| **Rerank** | **Not a factor** | p95 15 ms |

**Latency share (approximate at p95):** embed ~**59%**, candidate_fetch ~**52%** of phase budgets (not additive — worst phases often co-occur on same request). Both must be addressed; neither alone closes the 9066 ms p95 gap.

### 2.2 Slowest prompts / profiles

| Rank | Profile | total_ms | embed_ms | cf_ms | Query (truncated) | Class |
|-----:|---------|--------:|---------:|------:|-------------------|-------|
| 1 | `obo_helper` | **11790** | 5168 | **6012** | Summarize the latest offers I have received… | **mixed (cf-dominant)** |
| 2 | `obo_helper` | **8158** | 3775 | **4224** | What are the most recent pricing or revision changes… | **mixed (cf-dominant)** |
| 3 | `shadow_default` | **6439** | **5780** (timeout) | 0 | Give me an owner-visible summary of OBO activity… | **embed timeout → zero-result** |
| 4 | `obo_helper` | 6136 | 3387 | 1993 | Give me an owner-visible summary of OBO activity… | **embed-bound** |
| 5 | `shadow_default` | 3816 | 7 (cache) | **3328** | Summarize the latest offers… | **cf-bound** |

**Pattern:** Seller/OBO prompts under `obo_helper` drive worst tails. Default profile without route hints is vulnerable to embed timeout on OBO-shaped queries. Revision + catalog prompts hit high typed fanout (listing + listing_revision + obo_offer_summary).

### 2.3 Timeout root cause (Ollama)

| Hypothesis | Assessment |
|------------|------------|
| **Cold start** | **Partially ruled out** — harness warmup gate passed (3 consecutive embeds &lt;2s after initial 14s probe). Timeout occurred on **non-warmup** shadow_default run, not first harness query. |
| **Sustained variance** | **Primary** — embed p95 5321 ms with 2 outliers ≥5s; T20.13L documented warmup p95 spikes ~25s on Ollama despite median &lt;2s. |
| **Request contention** | **Possible** — shadow runs embed then immediately fetch; benchmark fires keyword + default + obo_helper per query in sequence. No dedicated embed isolation. |
| **Query shape** | **Contributing** — timeout on long OBO owner query with 0 hint terms (default profile); obo_helper same query succeeds with cf 1993 ms. |

**Conclusion:** Timeouts are **not** harness cold-start artifacts; they are **Ollama embed tail latency** under load/variance. Classify timeout separately from empty corpus (zero-result) in harness and add bounded single retry in shadow path only.

### 2.4 Why candidate_fetch is slow

| Factor | Role | Evidence |
|--------|------|----------|
| **Exact pgvector sort** | **Primary** | No ANN index on `embedding_vec`; T20.10U: `Gather Merge` + `Sort` on `<=>` over filtered chunks |
| **No ANN index** | **Primary** | `embedded_total=10065`; index status **NONE** |
| **Typed fanout** | **Primary** | obo_helper runs multiple typed fetches + global pool; top cf 6012 ms on offers-summary query |
| **Over-broad source expansion** | **Secondary** | Global default fetch LIMIT **24** (`max_chunks*3`); scans ~1901 embedded rows per worker (EXPLAIN) |
| **Duplicated fetches** | **Secondary** | Same query executed as keyword + shadow_default + shadow_obo_owner; default with cache_hit still pays cf 3328 ms |
| **High corpus size** | **Growing factor** | 10,065 embedded / 4697 visible to contract user; exact sort cost scales with embedded rows |
| **Privacy join cost** | **Minor** | Nested loop to `ai_documents` for visibility filter; not dominant vs sort |

T20.10U EXPLAIN (global fetch): `Parallel Index Scan` → `Gather Merge` → `Sort Key: embedding_vec <=> query` — classic exact k-NN at ~10k rows.

Typed OBO fetch (LIMIT 8): cheaper plan (~1182 cost) but still sort within type; repeated per source type in fanout multiplies wall time.

### 2.5 Safe optimizations (no production keyword change)

| Change | Scope | Production impact |
|--------|-------|-------------------|
| Harness warmup requirement | benchmark scripts | None |
| Shadow-only embed retry (1×) | `rag_retrieval.py` shadow branch | None — keyword path unchanged |
| Timeout vs zero-result classification | diagnostics + harness | None |
| Shadow-only fetch caps / typed-first skip | `shadow_profiles.py`, shadow fetch strategy | None if gated behind shadow flag |
| Skip redundant global fetch when profile is strongly typed | shadow retrieval only | None |
| Query-embed cache | shadow/diagnostic | None on keyword |
| Benchmark result cache | scripts only | None |

### 2.6 Requires ops approval or DB change

| Change | Approval |
|--------|----------|
| HNSW / IVFFlat ANN index on `embedding_vec` | **Ops + explicit owner** (T20.14F) |
| Ollama keep-alive / resource floors / sidecar | **Infra** (optional parallel track) |
| Embedding tranches / coverage to 15% | **Explicit owner** — not latency-first |
| Overlap flags default-on | **Forbidden** |
| Vector / hybrid production default | **T20.15 only after T20.14H** |

---

## 3. Root-cause classification

```text
Primary blockers:
- embed variance / timeout (Ollama tail latency; 1 timeout → 1 zero-result)
- exact pgvector candidate_fetch at 10k corpus (no ANN; sort + fanout)
- source-type fanout / typed fetch cost (obo_helper multi-fetch; global LIMIT 24)

Secondary blockers:
- overlap mismatch (11/16 zero chunk overlap — not latency; defer to T20.14G)
- optional 15% coverage gap (~13.8% — not latency; no tranche in latency lane)
- product UI telemetry WARN (keyword UI p95 — product lane, not shadow)
```

---

## 4. Implementation options (ranked)

### Option A — Diagnostic embed stabilization

| Aspect | Detail |
|--------|--------|
| **Scope** | Require warmup before shadow eval; **one** bounded retry on embed timeout in shadow path; classify `embed_timeout` vs `zero_result_empty_corpus` in diagnostics + harness |
| **Risk** | **Low** |
| **Expected effect** | Eliminate false zero-results; stabilize measurements; reduce embed-timeout tail **if** retry succeeds |
| **Production** | Untouched |
| **Rank** | **1 — implement in T20.14D** |

### Option B — Candidate fetch trim (lightweight)

| Aspect | Detail |
|--------|--------|
| **Scope** | Reduce per-type caps on latency-sensitive shadow profiles; skip global fanout when route profile is strongly classified; avoid duplicate listing/global fetch when typed pool satisfies diversity; preserve ≥5 source types in aggregate diagnostics |
| **Risk** | **Medium** — may reduce overlap pool; must re-measure overlap after latency |
| **Expected effect** | cf p95 reduction on obo_helper/revision prompts (target: cut 6012 ms / 4224 ms tails materially) |
| **Production** | Shadow-only; keyword caps unchanged |
| **Rank** | **2 — lightweight subset in T20.14D** |

### Option C — Shadow result cache / query embed cache

| Aspect | Detail |
|--------|--------|
| **Scope** | Short TTL cache for normalized prompt embedding; optional benchmark-only `(query_hash, profile)` result cache |
| **Risk** | **Medium** — cache invalidation; must not affect production keyword |
| **Expected effect** | Repeat telemetry / CI stability only; **does not fix first-hit latency** |
| **Rank** | **3 — optional harness polish after D; not on critical path** |

### Option D — ANN index design

| Aspect | Detail |
|--------|--------|
| **Scope** | HNSW vs IVFFlat design, CONCURRENTLY build, backup, EXPLAIN before/after, DROP INDEX rollback — **design/ops only** |
| **Risk** | **High / ops** |
| **Expected effect** | Largest cf reduction at 10k+ scale; recall tuning required |
| **Rank** | **4 — T20.14F only if T20.14E still fails cf gate** |

### Option E — Shadow overlap v2 (deferred)

| Aspect | Detail |
|--------|--------|
| **Scope** | Document/entity overlap, keyword anchoring, hybrid rerank — **not a latency fix** |
| **Risk** | **Medium** |
| **Expected effect** | Overlap gates only |
| **Rank** | **5 — T20.14G after latency passes** |

---

## 5. Recommended sequence

This sequence refines T20.14B for latency-first burn-down:

```text
T20.14D — implement Option A + lightweight Option B only (shadow/diagnostic code)
T20.14E — read-only 3-run warm latency re-eval (not rollout approval)
T20.14F — ANN index ops design if candidate_fetch p95 still fails after D
T20.14G — overlap v2 design only after latency gates trend PASS
T20.14H — 5-run final stability re-eval + full gate table
T20.15A–D — canary → production (only if T20.14H passes all gates + owner approval)
```

**Do not skip E before F:** prove code-level trims insufficient before index ops.

---

## 6. T20.14D implementation spec

### Allowed changes

| Area | Specific changes |
|------|------------------|
| **Shadow diagnostic code** | Embed retry (1×, bounded timeout) on shadow branch only; enrich `ShadowEmbedDiagnostics` with `timeout`, `retry_attempted`, `retry_succeeded` |
| **Timing harness** | Separate `embed_timeout` from `zero_result` in `rp-ai-shadow-real-query-timing.sh` reporting |
| **Candidate fetch (shadow only)** | Lower fanout multiplier (e.g. global LIMIT from `max_chunks*3` toward `max_chunks*2` for diagnostic); typed-first: skip global pool when profile confidence high; dedupe listing fetch when typed listing pool already populated |
| **Profile caps** | `obo_helper`, `seller_sales_summary`: reduce non-primary source caps via existing `non_primary_source_caps` / `resolve_shadow_fetch_strategy` — shadow path only |
| **Tests** | Unit tests for timeout classification, retry behavior, shadow-only cap gating |
| **Docs** | T20.14D acceptance note after implementation |

**Files likely touched (implementation phase only):**

- `services/python-ai-service/app/ai/rag_retrieval.py` (shadow embed + fetch)
- `services/python-ai-service/app/ai/shadow_profiles.py` (caps / strategy)
- `scripts/rp-ai-shadow-real-query-timing.sh` (classification)
- `services/python-ai-service/tests/test_rag_retrieval.py`

### Forbidden changes

| Forbidden | Reason |
|-----------|--------|
| Vector / hybrid production default | T20.15 blocked |
| ANN index creation | T20.14F ops gate |
| DB migration | Out of scope for D |
| Broad embedding backfill / tranches | Not latency-first |
| Default-on overlap flags | Diagnostic only |
| Keyword retrieval behavior changes | Production path frozen |
| Product keyword caps / synthesis | Phase 21 closed |

### Success criteria (unlocks T20.14E only)

T20.14D **does not** approve rollout. It only enables T20.14E re-eval.

---

## 7. Rollback

If T20.14D regression detected:

```text
1. Revert T20.14D code commit(s) on main.
2. Confirm env unchanged: AI_RAG_SHADOW_VECTOR=0, overlap flags 0/0.
3. Run keyword smoke:
   bash scripts/audit-rp-ai-rag-contract.sh
   bash scripts/rp-ai-rag-quality-smoke.sh
4. Run product Playwright suites (seller, record intel, longform).
5. Run: node scripts/ai-quality-telemetry-report.mjs
6. Re-run warm shadow timing for baseline comparison.
7. Document rollback in bench_logs locally; do not commit artifacts.
```

Keyword retrieval is on a separate code path; rollback restores prior shadow behavior only.

---

## 8. Gate after T20.14D — T20.14E targets

**T20.14E:** read-only; **3 consecutive warm runs**:

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 \
  bash scripts/rp-ai-shadow-real-query-timing.sh
# repeat 3×
```

| Metric | T20.14E target | T20.14A baseline |
|--------|----------------|------------------|
| embed timeouts | **0** | 1 |
| zero-result shadow | **0** | 1/16 |
| shadow p95 | **materially improved** (directional; may still exceed 3000 ms) | 9066 ms |
| candidate_fetch p95 | **trending down** | 4671 ms |
| keyword Playwright suites | **PASS** | PASS |
| Phase 21 telemetry | **0 WARNs preferred** | 1 WARN |
| leakage | **0** | 0 |

If T20.14E fails cf gate → proceed to **T20.14F** (ANN design). If overlap still fails after latency improves → **T20.14G**. Rollout remains blocked until **T20.14H** passes **all** gates in T20.14B.

---

## 9. Artifacts referenced (local, not committed)

| Artifact | Path |
|----------|------|
| T20.14A baseline | `docs/ai-platform/T20-14A-current-vector-readiness-baseline.md` |
| Warm shadow timing | `bench_logs/ai-platform/t20-10-shadow-real-query-20260628-140942.md` |
| pgvector EXPLAIN | `bench_logs/ai-platform/t20-10u-pgvector-candidate-fetch-20260628-141747.md` |
| Route shadow quality | `bench_logs/ai-platform/t19-6-route-shadow-quality.md` |
| Prior latency plan | `docs/ai-platform/T20-13L-shadow-latency-remediation-plan.md` |
| Prior triage | `docs/ai-platform/T20-13G-shadow-fetch-latency-overlap-triage.md` |
| Gate template | `docs/ai-platform/T20-14B-vector-rollout-gate-template.md` |

---

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14D candidate-fetch/embed-stability implementation
```

**Stop here.** Do not start T20.14D without explicit approval.
