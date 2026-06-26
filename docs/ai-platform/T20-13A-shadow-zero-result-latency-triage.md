# T20.13A — Shadow zero-result, latency, and overlap triage (read-only)

**Status:** READ-ONLY triage complete  
**Generated:** 2026-06-26  
**Baseline SHA:** `4e99509`  
**Embedded:** 10,065 (~13.8%)  
**Mode:** no code changes, no DB writes, no rollout

## Executive summary

After clearing the **≥10k embedded count gate**, shadow diagnostics still fail rollout gates for three **distinct** reasons:

1. **Zero-result (8/16 in T20.13 eval)** — predominantly **harness request failures** (`http_time_s=0`), not pgvector returning empty result sets. When requests complete, zero-result is **rare (1/16)** and tied to **embed timeout before fetch**.
2. **Shadow p95 (6,457 ms in T20.13 eval; 7,295 ms in T20.13A rerun)** — **embed + candidate_fetch** dominate; exact pgvector sort cost grows with corpus; Ollama embed variance remains high.
3. **Default/off overlap (15/16 in T20.13 eval)** — **structural mismatch** between keyword lexical retrieval and shadow semantic retrieval (`same_source_type_different_chunks`); more embeddings **increase semantic spread** without improving chunk-id parity.

```text
Vector rollout: NOT APPROVED
Phase 21: not started
Production retrieval remains keyword
```

## Evidence runs

| Run | Artifact | shadow p95 | zero-result | zero-overlap | embed timeouts | source diagnostic |
|-----|----------|----------:|------------:|-------------:|---------------:|-------------------|
| T20.13 post-write eval | `t20-10-shadow-real-query-20260626-125154.md` | 6,457 ms | **8/16** | **15/16** | 0 (harness) | FAIL (transient) |
| T20.13 pre-write gate | `t20-10-shadow-real-query-20260626-123033.md` | 2,925 ms | 0/16 | 11/16 | 0 | PASS |
| **T20.13A fresh rerun** | `t20-10-shadow-real-query-20260626-165707.md` | **7,295 ms** | **1/16** | 11/16 | 1 | **PASS** |
| T20.13A live inference | `live-inference/20260626-170335.md` | n/a | 1 embed timeout | 1/7 default; 3/7 flagged | 1 | n/a |

**Conclusion:** T20.13's worst numbers mix **cold/harness failure** with **warm-run structural overlap failure**. Fresh T20.13A confirms retrieval usually returns results when requests complete; instability is embed-bound and benchmark-harness sensitive.

---

## Zero-result analysis

### T20.13 eval (8/16) — primary failure class: `request_error`

In `20260626-125154.md`, the last **four query themes** (notifications, bidding, revisions, negotiation) show `http_time_s=0.000` for **both** keyword and shadow runs — **8 shadow runs** with missing diagnostics (`Shadow diagnostics missing: 8`).

| Query theme | Route/profile | embed_ms | timeout | cf_ms | selected | Expected types | Returned | Failure class |
|-------------|---------------|--------:|---------|------:|---------:|----------------|----------|---------------|
| notifications | default / obo_helper | n/a | n/a | n/a | 0 | listing, notification, obo | n/a | **request_error** |
| offer_bidding | default / obo_helper | n/a | n/a | n/a | 0 | listing, obo | n/a | **request_error** |
| listing_revisions | default / obo_helper | n/a | n/a | n/a | 0 | listing, revision, obo | n/a | **request_error** |
| negotiation_context | default / obo_helper | n/a | n/a | n/a | 0 | listing, obo | n/a | **request_error** |

These are **not** `candidate_fetch_returned_zero` or `privacy_filter_removed_all`. The timing harness lost the tail of the batch after cumulative latency (~50s+ into the run).

### T20.13A rerun (1/16) — failure class: `embed_timeout_before_fetch`

| Query theme | Route/profile | embed_ms | timeout | cf_ms | selected | Failure class |
|-------------|---------------|--------:|---------|------:|---------:|---------------|
| catalog_activity | obo_helper | **5,253** | **yes** | 0 | **0** | **embed_timeout_before_fetch** |

All other 15/16 shadow runs returned **selected=8**.

### Live inference (T20.13A)

| Case | embed ms | cf ms | shadow ms | status |
|------|--------:|------:|----------:|--------|
| negotiation_context (flags off) | 5,609 | 0 | 6,169 | **embed_timeout** |

---

## Latency analysis

### T20.13A fresh run aggregates (`20260626-165707.md`)

| Phase | p50 | p95 |
|-------|----:|----:|
| **Total shadow** | 2,334 ms | **7,295 ms** |
| **Embed** | 1,067 ms | **4,961 ms** |
| **Candidate fetch** | 1,039 ms | **2,455 ms** |
| Rerank/select | 3 ms | 9 ms |

### Top 5 slow runs (T20.13A)

| total_ms | embed_ms | cf_ms | selected | zero-result? | timeout? | mode |
|--------:|---------:|------:|---------:|:------------:|:--------:|------|
| 8,359 | 4,863 | 3,077 | 8 | no | no | shadow_obo_owner |
| 6,940 | 4,515 | 2,188 | 8 | no | no | shadow_default |
| **5,409** | **5,253** | 0 | **0** | **yes** | **yes** | shadow_obo_owner |
| 4,355 | 2,956 | 1,261 | 8 | no | no | shadow_default |
| 4,033 | 2,947 | 1,013 | 8 | no | no | shadow_obo_owner |

**Findings:**

- Slow runs with results: **embed + candidate_fetch** both contribute; rerank is negligible.
- The only zero-result slow run: **embed timeout** — fetch never ran.
- Warmup gate itself hit **TimeoutError** on first attempt (25s) before passing — embed cold-start remains a dominant variance source.

### T20.13 eval vs pre-write (same day)

| Run | shadow p95 | zero-result | Interpretation |
|-----|----------:|------------:|----------------|
| Pre-write `123033` | 2,925 ms | 0/16 | Warm, stable |
| Post-write `125154` | 6,457 ms | 8/16 | Harness tail failures + heavier embed/fetch |
| T20.13A `165707` | 7,295 ms | 1/16 | Warm gate but embed spikes persist |

---

## Overlap analysis

### Why default/off overlap is 15/16 (T20.13 eval) or 11/16 (T20.13A)

| Reason | T20.13 eval | T20.13A |
|--------|------------:|--------:|
| `same_source_type_different_chunks` | 6 | 9 |
| `source_type_mismatch` | 1 | 1 |
| `unknown` (missing diagnostics) | **8** | 1 |

When diagnostics exist, overlap failure is almost always **same source type, different chunk IDs** — keyword and shadow agree on *types* but not *chunks*.

### Is this no-shadow-result?

**No** for completed runs — selected_count=8 is typical. Zero-overlap ≠ zero-result.

### Does flagged overlap help?

| Harness | Default overlap | Flagged overlap |
|---------|----------------:|----------------:|
| Live inference (T20.13A) | 1/7 | **3/7** |
| Timing (T20.13A) | 5/16 doc overlap >0 | n/a (flags off only in timing script) |

Flagged diagnostic mode **improves overlap** on some prompts (entity/doc overlap on revisions, notifications, bidding) but remains **diagnostic-only** and insufficient for rollout.

### Did more embeddings make overlap worse?

**Partially yes, indirectly.** Keyword retrieval is **lexical** and stable. Shadow retrieval ranks by **cosine distance** over a **larger embedded pool** (10k vs 5k). More near-neighbor candidates increases the chance shadow selects semantically related but **different chunks** from the same listing/revision/notification documents. Embedding count does not align chunk IDs with keyword token matches.

---

## Root cause evaluation

| Candidate | Verdict | Evidence |
|-----------|---------|----------|
| 1. Ollama embed timeout/cold variance | **PRIMARY** | Warmup TimeoutError; 5s+ embed outliers; zero-result when timeout; p95 embed 3–5s |
| 2. Exact pgvector candidate fetch cost | **PRIMARY** | cf p95 2.4–2.8s; top slow runs split embed/fetch; grows with 10k corpus |
| 3. Larger corpus → semantic spread | **CONTRIBUTING** | same_source_type_different_chunks dominant; overlap not improved at 10k |
| 4. Route/profile after OBO exhaustion | **MINOR** | OBO pool=0; profiles still surface listing/revision/notification; not root cause |
| 5. Metadata/entity mismatch | **MINOR** | source_type_mismatch on 1 run; flagged entity boost helps some cases |
| 6. Harness/diagnostic mismatch | **CONFIRMED** | 8/16 zero-result in T20.13 = batch request_error; inflates FAIL counts |

---

## Contract gates (T20.13A rerun)

| Gate | Result |
|------|--------|
| Source diagnostic | **PASS** (0 issues) |
| RAG contract | PASS |
| Quality smoke | PASS |
| Runtime/endpoints | PASS |
| Provider/pgvector | PASS |
| Live inference keyword | 7/7 PASS |
| Leakage | PASS |
| OCH | PASS |

---

## Required verdict

```text
Vector rollout: NOT APPROVED
Phase 21: not started
Production retrieval remains keyword
```

Next: **T20.13B** design-only fix proposal → **T20.13C** only with explicit approval.
