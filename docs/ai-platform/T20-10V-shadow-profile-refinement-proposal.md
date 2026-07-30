# T20.10V — Shadow profile refinement proposal (design-only)

**Generated:** 2026-06-18  
**Baseline SHA:** `3c051e9` (T20.10U pgvector candidate-fetch diagnostics)  
**Mode:** design-only — no product behavior changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

| Item | Status |
|------|--------|
| Vector rollout | **NOT APPROVED** |
| Keyword retrieval | **Production default** (unchanged) |
| `AI_RAG_SHADOW_VECTOR` | `0` (unchanged) |
| This ticket | **Design-only** — no code, DB, or index changes |
| Recommended next step | **T20.10W** implementation — **approval required** before any code change |
| ANN index exploration | **Separate ops-approved ticket** — not in scope |

T20.10U established that shadow `candidate_fetch` latency is dominated by **exact vector distance sort** over the embedded corpus with **no ANN index**. The safest next step is a **shadow profile refinement proposal** to reduce redundant fetch work — not database or index changes.

---

## Problem statement

### Exact vector sort over global embedded corpus

Shadow vector retrieval (`retrieve_chunks_vector_shadow` in `rag_retrieval.py`) executes:

```sql
ORDER BY c.embedding_vec <=> $vec ASC
LIMIT $limit
```

With no ivfflat/hnsw index on `embedding_vec`, Postgres plans use **parallel btree scan + full Sort on distance** before applying LIMIT. For the contract user, ~2,404 embedded chunks are visible (owner 1,221 + public 1,183). Global fetches with `LIMIT = max_chunks * 3` (typically 24) still sort thousands of rows.

### Multi-fetch route modes amplify candidate_fetch latency

When `route_mode` is active (profiles such as `obo_helper`, `seller_sales_summary`, `auction_risk`), shadow retrieval runs:

1. **Global fetch** — `limit = max_chunks * 2` (OBO-focused) or `max_chunks * 3` (default)
2. **Per-type fetches** — one round-trip per entry in `vector_fetch_extra_types()` for the resolved profile
3. **Merge** — `_merge_vector_rows()` deduplicates by chunk id but does not skip redundant fetches

All fetches are timed under a single `candidate_fetch` diagnostic bucket. Route-mode profiles therefore pay **1 + N** exact-sort queries per shadow run.

### Listing/catalog queries are especially affected

Embedded visible corpus is listing-heavy:

| source_type | embedded_visible |
|-------------|-----------------:|
| listing | 1,365 |
| listing_revision | 474 |
| record | 288 |
| auction_bid_summary | 253 |
| obo_offer_summary | 18 |
| notification | 6 |

Catalog, buyer-interest, and listing-revision prompts use `shadow_default` or listing-biased profiles. T20.10T/T20.10U show **candidate_fetch_ms 1,394–2,684** on embed-cache-hit runs where pgvector sort dominates — not embed or rerank.

### What is not the problem

| Factor | Evidence (T20.10P/T/U) |
|--------|------------------------|
| rerank/select | p95 ≤ 60 ms |
| T20.10N metadata refresh | Metadata-only; no query-plan change |
| Privacy filters | `privacy_filter` ms ≈ 0; ~2,404 rows already scoped |
| Missing pgvector extension | Extension present; column typed `vector(768)` |

---

## Evidence from T20.10U

### No vector ANN index

Indexes on `ai.ai_document_chunks`:

- `idx_ai_document_chunks_document` (btree on `document_id`)
- btree on `source_type`, `visibility`

**No index on `embedding_vec`.** Every shadow fetch performs exact nearest-neighbor ordering via sort.

### Global fetch scans/sorts broad embedded set

Global shadow fetch (LIMIT 24) plan shape:

```text
Gather Merge → Sort on (embedding_vec <=> query)
  → Parallel Index Scan (embedding_vec IS NOT NULL filter)
  → Index Scan ai_documents (visibility + source_type <> message)
```

Estimated cost ~5,218–10,280. Sorts ~4,500 row estimates before LIMIT.

### Typed fetches are more selective and cheaper

OBO-only fetch (LIMIT 8, `source_type = 'obo_offer_summary'`):

```text
Sort on distance (~28 rows)
  → Index Scan idx_ai_documents_source_type
  → Nested Loop to chunks
```

Estimated cost ~1,178 — an order of magnitude cheaper than global.

Listing-only and notification-only scoped fetches use `idx_ai_documents_source_type` and scan a fraction of the global corpus.

### Privacy filters are not the primary blocker

Visibility scoping reduces embedded rows from 5,565 total to 2,404 visible for the contract user. Further per-type filtering happens in rerank/select (negligible cost), not as a pre-vector index predicate on global fetch.

### Slow runs correlate with fetch path, not ranking

T20.10T top `candidate_fetch_ms` contributors (embed cache hit):

| Query theme | candidate_fetch_ms | Fetch path |
|-------------|-------------------:|------------|
| Catalog / buyer interest | 2,130–2,684 | Global over listing-heavy corpus |
| Notifications | 1,684 | Global (only 6 embedded notification chunks) |
| Listing revisions | 1,394 | Global |

---

## Current shadow fetch behavior (reference)

For implementation planning in T20.10W, the following code paths are the refinement targets. **No changes in T20.10V.**

### Route-mode fetch sequence (`rag_retrieval.py`)

```python
# route_mode branch (simplified)
global_limit = max_chunks * 2 if obo_focused else max_chunks * 3
global_rows = await _fetch_vector_rows(..., limit=global_limit)
for st in vector_fetch_extra_types(resolved_profile, ...):
    type_rows = await _fetch_vector_rows(..., limit=type_limit, extra_source_type=st)
    pool_rows = _merge_vector_rows(pool_rows, type_rows)
```

### Profile extra types (`shadow_profiles.py`)

| Profile | `vector_fetch_extra_types()` (default) |
|---------|----------------------------------------|
| `obo_helper` (OBO-focused) | `["obo_offer_summary", "listing"]` |
| `seller_sales_summary` | Up to 4 types based on query terms |
| Others | First 3 of `preferred_source_types()` |

Global fetch always runs first regardless of profile classification strength.

---

## Proposed shadow-only refinements

All refinements apply **only when shadow vector is enabled** (`AI_RAG_SHADOW_VECTOR=1`). Keyword retrieval, route weights, API contracts, and production defaults remain untouched.

### Option A — Conservative scoped-fetch preference (recommended)

**Intent:** For strongly classified route profiles, prefer source-scoped fetch before global fetch; keep global fetch as fallback only.

**Proposed rules:**

| Condition | Behavior |
|-----------|----------|
| Profile confidence high (e.g. `obo_helper` with OBO query terms, `record_valuation` with record terms) | Run typed fetch for primary `preferred_source_types[0]` first |
| Typed fetch returns ≥ `max_chunks` candidates above score floor | Skip global fetch; proceed to merge/rerank |
| Typed fetch underfills | Run global fetch as fallback with existing `max_chunks * 2/3` limit |
| `generic_rag` or weak classification | Preserve current global-first behavior |

**Expected impact:** Listing/catalog prompts classified as `seller_sales_summary` or `record_valuation` avoid sorting 2,404 rows when a typed listing or record fetch suffices.

**Risk:** Low — global fallback preserves recall when scoped fetch underfills.

### Option B — Reduce duplicate multi-fetch (recommended)

**Intent:** Detect redundant global + per-type fetch combinations; avoid second fetch when the merged pool is already sufficient.

**Proposed rules:**

| Condition | Behavior |
|-----------|----------|
| Global fetch completed; pool size ≥ `max_chunks * 2` after dedupe | Skip per-type fetches whose `source_type` is already represented at ≥ N rows in pool |
| `obo_helper` + OBO-focused hints | If `obo_offer_summary` typed fetch would duplicate global results and pool ≥ 8 OBO rows, skip typed OBO fetch |
| `seller_sales_summary` | If global pool already contains listing + obo_offer_summary chunks meeting slot caps, skip redundant typed fetches for those types |

**Expected impact:** Cuts 1–3 exact-sort round-trips on route-mode profiles — the largest immediate latency win without changing candidate quality when pool is already rich.

**Risk:** Low–medium — requires conservative sufficiency thresholds to avoid under-fetching edge cases.

### Option C — Global fanout cap (deferred)

**Intent:** Reduce global `max_chunks * 3` fanout for shadow-only catalog/listing profiles.

**Example:** Cap global LIMIT to `max_chunks * 2` (or `max_chunks + 4`) for profiles where listing/listing_revision dominate preferred types.

**Why deferred:** Higher risk to source diversity and keyword/vector overlap metrics (12/16 zero-overlap already failing rollout gate). May truncate recall for cross-source prompts (e.g. seller_sales_summary needing notification + auction context).

**Revisit only if** Options A + B are implemented and T20.10T benchmarks show insufficient candidate_fetch improvement.

### Explicitly out of scope

| Item | Reason |
|------|--------|
| ANN index (ivfflat/hnsw) | Ops-approved only; separate DB ticket |
| Keyword retrieval changes | Production default; stability requirement |
| Route weight changes | Affects rerank, not fetch; separate concern |
| Vector default enablement | Rollout gates still fail |
| Metadata refresh / embedding backfill | Not causal per T20.10U |

---

## Recommended design stance

**Propose A + B for T20.10W approval.**

| Option | Stance |
|--------|--------|
| A — Scoped-fetch preference | **Include** in T20.10W |
| B — Duplicate multi-fetch reduction | **Include** in T20.10W |
| C — Global fanout cap | **Defer** unless A + B insufficient |
| ANN index | **Defer** to separate ops-approved DB ticket |

Implementation surface: `shadow_profiles.py` (new fetch strategy hints / sufficiency thresholds) and `rag_retrieval.py` route-mode fetch loop — **T20.10W only, after explicit approval**.

---

## Risk analysis

### Leakage risk

**Low if unchanged.** Fetch refinements do not alter visibility filters (`_build_scope_filters`) or owner/public scoping. Typed fetches use the same SQL predicates with an added `source_type` clause.

**Mitigation:** Re-run leakage diagnostic and OBO owner-visible gate after T20.10W.

### Source diversity risk

**Medium for Option C; low for A + B.** Skipping global fetch when typed fetch suffices could miss cross-source chunks (e.g. notification context on a listing query). Option A's global fallback mitigates this.

**Mitigation:** Set conservative underfill thresholds; monitor overlap and source-mix diagnostics.

### Overlap risk

**Medium.** Rollout gate already shows 12/16 zero chunk-overlap between keyword and shadow. Reducing global fanout or skipping fetches may widen or narrow overlap unpredictably.

**Mitigation:** T20.10T before/after comparison; fail T20.10W if zero-overlap count regresses without latency gain.

### Latency risk

**Low for implementation; high if skipped.** Current multi-fetch pattern is a known latency amplifier. Refinements target measured bottleneck.

**Mitigation:** Require embed-cache-hit runs in benchmark comparison to isolate fetch changes from Ollama variance.

### Keyword stability risk

**None for T20.10V.** Design-only. For T20.10W: keyword path is separate (`retrieve_chunks_keyword`); shadow refinements must not alter keyword code paths or shared ranking weights.

**Mitigation:** `audit-rp-ai-rag-contract.sh` and keyword stability smoke on every T20.10W validation run.

---

## Validation plan (for T20.10W implementation)

T20.10V is docs-only. The following gates apply when refinements are implemented:

| Gate | Command / artifact | Pass criteria |
|------|-------------------|---------------|
| Benchmark before/after | `BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh` | `candidate_fetch_ms` p95 decreases on embed-cache-hit contributors; no regression in shadow_total_ms p50 |
| EXPLAIN comparison | `bash scripts/rp-ai-pgvector-query-plan-diagnostic.sh` | Fewer global sorts or lower estimated cost on route-mode profiles |
| RAG contract | `bash scripts/audit-rp-ai-rag-contract.sh` | PASS |
| Quality smoke | `bash scripts/rp-ai-rag-quality-smoke.sh` | PASS |
| Source diagnostic | `bash scripts/rp-ai-shadow-source-diagnostic.sh` | No new leakage; source mix documented |
| RP scan | `bash scripts/rp-rp-decontaminate-scan.sh` | PASS |
| Keyword stability | Existing contract gates | Unchanged keyword behavior |

Compare against T20.10T-hardened benchmark artifacts; do not commit `bench_logs/`.

---

## Rollback plan

| Scenario | Action |
|----------|--------|
| T20.10W latency regression | Revert shadow profile / fetch-loop commits only |
| Overlap or leakage regression | Revert T20.10W; re-run source diagnostic |
| Unexpected rerank behavior | Revert T20.10W (rerank inputs changed if pool composition shifts) |

Keyword retrieval, route weights, and production config remain untouched throughout. Rollback is a code revert — no DB migration or index rollback required.

---

## Follow-up tickets

| Ticket | Scope | Gate |
|--------|-------|------|
| **T20.10W** | Implement Options A + B in shadow fetch path only | **Explicit approval required** — do not start until this proposal is reviewed |
| **T20.10X** (suggested name) | ANN index exploration (ivfflat/hnsw on `embedding_vec`) | Ops approval + rollout gate pass — separate from profile work |

**Do not implement T20.10W until this proposal is reviewed and approved.**

---

## T20.10U label check

The committed `scripts/rp-ai-pgvector-query-plan-diagnostic.sh` labels are **correct**:

- `obo_helper extra fetch — obo_offer_summary only` → `source_type = 'obo_offer_summary'`
- `listing-only scoped fetch` → `source_type = 'listing'`

No doc/script fix required for swapped labels.

---

## Definition of done (T20.10V)

- [x] Proposal document exists
- [x] No product behavior changed
- [x] No retrieval code changed
- [x] No DB/index changes
- [x] T20.10W marked approval-required
- [x] Vector rollout remains NOT APPROVED

## Files changed

- `docs/ai-platform/T20-10V-shadow-profile-refinement-proposal.md` (this document)

## Validation (this ticket)

```bash
git status --short
bash scripts/rp-rp-decontaminate-scan.sh
```

RP: PASS (588 files scanned).

**Vector rollout:** NOT APPROVED
