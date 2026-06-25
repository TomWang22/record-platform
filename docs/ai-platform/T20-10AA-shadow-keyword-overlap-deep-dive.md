# T20.10AA — Shadow/keyword overlap deep dive

**Generated:** 2026-06-25  
**Baseline SHA:** `26eb884` (T20.10Z post-refinement readiness eval)  
**Mode:** read-only diagnostics — no ranking, keyword, or vector-default changes  
**Vector rollout:** NOT APPROVED

## Executive verdict

Shadow and keyword paths **both retrieve valid, owner-scoped results**, but **chunk-level overlap remains poor (11/16 zero)** after T20.10W latency work and T20.10Y diversity restoration. Failures are **predominantly complementary retrieval**, not empty shadow or leakage:

- **10/11** zero-overlap runs: `same_source_type_different_chunks` — shared source types, **different chunk IDs** (often different listings within `listing`, or OBO vs listing slot tradeoff).
- **1/11** zero-overlap runs: `source_type_mismatch` — keyword returns **OBO-only** while shadow returns **listing + listing_revision** on a revision-themed query.

T20.10Y **restored source-type diversity** (`listing_revision`, `notification` now appear in shadow selections) and improved **entity/doc overlap on some routes**, but **did not materially improve chunk-overlap** because diversity top-ups surface **adjacent semantic neighbors**, not the same lexical keyword hits.

**Overlap remains a rollout blocker** for vector default. **Do not roll out vector.** Recommend **T20.10AB** (design-only overlap refinement proposal) — not implementation.

---

## T20.10Z baseline metrics (canonical)

| Gate | Value | Status |
|------|-------|--------|
| Embedded coverage | 7.62% (5,565 / 73,043) | **FAIL** |
| Source diversity (hinted union) | 6 types | **PASS** |
| Owner-visible OBO embedded | 18 | **PASS** |
| Shadow p95 (warmup=1, run `215017`) | 2,839 ms | **PASS**† |
| Embed p95 | 950 ms | **PASS**† |
| Embed timeouts | 0 | **PASS**† |
| Leakage | 0 | **PASS** |
| Keyword stability (real-query harness) | unchanged summaries/refs | **PASS** |
| Zero chunk-overlap | **11/16** | **FAIL** |
| doc-overlap >0 | **5/16** | partial |
| entity-overlap >0 | **5/16** | partial |
| zero-result shadow runs | **0/16** | improved |

† Latency passes on T20.10Z canonical run; historically unstable (T20.10O/T20.10Y bad runs).

**Confirmatory T20.10AA run** (`221431`): identical overlap distribution (11/16 zero, same built-in reasons, same per-query shadow type mixes).

**Artifacts (local, not committed):**

- `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-215017.jsonl` (primary)
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-221431.jsonl` (confirmatory)

---

## Deep-dive answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Which 11/16 runs have zero chunk-overlap? | Listed in per-query table below |
| 2 | Doc / entity / type overlap on zeros? | **5/11** have doc=0, entity=0; **0/11** have doc>0 without chunk overlap on zeros; overlap-present runs show entity≥3 when paths align |
| 3 | Keyword lexical vs shadow semantic? | **Yes** — keyword ranks by lexical match on query terms; shadow ranks by cosine + route weights + diversity top-ups |
| 4 | Shadow summaries vs keyword event chunks? | **Partially** — keyword often returns **narrow event chunks** (OBO summaries for offer/revision queries); shadow returns **broader listing/revision context** |
| 5 | Metadata aliases help entity not chunk? | **Yes** — entity_overlap>0 on 5/16 (e.g. revision/OBO routes share `listing_id` bridges) while chunk IDs differ |
| 6 | T20.10Y top-ups help diversity not overlap? | **Yes** — `notification` and `listing_revision` now in shadow mixes; chunk overlap unchanged on 11 zero runs |
| 7 | Harmful or complementary? | **Mostly complementary** — shadow surfaces cross-type context keyword omits; not evidence of worse relevance |
| 8 | Safest future refinement? | **Entity-aware shadow hints** + **keyword-anchor diagnostic blend** (T20.10AB); not generic ranking patch |

---

## Per-query overlap table (all 16 shadow runs)

Keyword types from paired keyword rows in run `215017`. Shadow types from `shadow_vector.source_type_distribution`.

| # | Query theme | Mode | Profile | KW types | Shadow types | Chunk | Doc | Ent | Built-in reason | T20.10AA class | Likely remediation |
|---|-------------|------|---------|----------|--------------|------:|----:|----:|-----------------|----------------|-------------------|
| 1 | Latest offers received | shadow_default | seller_sales_summary | listing×6, rev×1 | listing×3, obo×5 | 0 | 0 | 0 | same_source_type_different_chunks | topup_diversity_not_overlap | keyword-anchor hint; optional OBO quota only on obo_owner mode |
| 2 | Latest offers received | shadow_obo_owner | obo_helper | listing×6, rev×1 | obo×5, listing×2, rev×1 | 0 | 0 | 0 | same_source_type_different_chunks | shadow_summary_vs_keyword_event_chunk | entity-aware hints from keyword `listing_id` |
| 3 | OBO activity summary | shadow_default | obo_helper | listing×8 | obo×5, listing×2, rev×1 | 0 | 0 | 0 | same_source_type_different_chunks | source_type_mismatch | profile routing review in T20.10AB only |
| 4 | OBO activity summary | shadow_obo_owner | obo_helper | listing×8 | obo×5, listing×2, rev×1 | 0 | 0 | 0 | same_source_type_different_chunks | shadow_summary_vs_keyword_event_chunk | keyword-anchor blend (diagnostic) |
| 5 | Pricing/revision changes | shadow_default | seller_sales_summary | obo×8 | listing×3, rev×5 | 0 | 0 | 0 | source_type_mismatch | source_type_mismatch | revision-scoped keyword parity study; no keyword change without approval |
| 6 | Pricing/revision changes | shadow_obo_owner | obo_helper | obo×8 | obo×5, listing×2, rev×1 | **2** | **2** | **6** | — | overlap_present | keep path — entity bridge works |
| 7 | Catalog / buyer interest | shadow_default | seller_sales_summary | listing×5, rev×2 | listing×8 | 0 | 0 | 0 | same_source_type_different_chunks | keyword_exact_match_vs_shadow_semantic | revision chunk neighbor expansion (shadow-only proposal) |
| 8 | Catalog / buyer interest | shadow_obo_owner | obo_helper | listing×5, rev×2 | obo×5, listing×2, rev×1 | 0 | 0 | 0 | same_source_type_different_chunks | topup_diversity_not_overlap | reduce OBO slot pressure or keyword-anchor |
| 9 | Notifications matter most | shadow_default | seller_sales_summary | obo×8 | listing×3, notif×2, obo×3 | 0 | 0 | 0 | same_source_type_different_chunks | topup_diversity_not_overlap | notification typed fetch helps diversity; needs entity bridge for overlap |
| 10 | Notifications matter most | shadow_obo_owner | obo_helper | obo×8 | obo×5, listing×2, rev×1 | **1** | **1** | **3** | — | overlap_present | metadata `listing_id` bridge (T20.10N) helps entity overlap |
| 11 | Bidding / offer activity | shadow_default | seller_sales_summary | obo×8 | listing×3, obo×5 | **1** | **1** | **3** | — | overlap_present | partial parity when types align |
| 12 | Bidding / offer activity | shadow_obo_owner | obo_helper | obo×8 | obo×5, listing×2, rev×1 | **2** | **2** | **5** | — | overlap_present | strong entity overlap when OBO profile matches query |
| 13 | Listing revisions / offer conversion | shadow_default | seller_sales_summary | obo×8 | listing×2, rev×3, obo×3 | 0 | 0 | 0 | same_source_type_different_chunks | topup_diversity_not_overlap | T20.10Y adds revision to pool; keyword still OBO-only top-8 |
| 14 | Listing revisions / offer conversion | shadow_obo_owner | obo_helper | obo×8 | obo×5, listing×2, rev×1 | **2** | **2** | **5** | — | overlap_present | OBO route + revision query → best parity |
| 15 | Private negotiation context | shadow_default | seller_sales_summary | listing×8 | listing×3, obo×5 | 0 | 0 | 0 | same_source_type_different_chunks | same_source_type_different_chunks | complementary listing mix |
| 16 | Private negotiation context | shadow_obo_owner | obo_helper | listing×8 | obo×5, listing×2, rev×1 | 0 | 0 | 0 | same_source_type_different_chunks | shadow_summary_vs_keyword_event_chunk | keyword-anchor / entity hints |

### Zero-overlap runs only (11)

| # | Query (short) | Mode | Class | Doc | Ent | Notes |
|---|---------------|------|-------|----:|----:|-------|
| 1 | Latest offers | default | topup_diversity_not_overlap | 0 | 0 | KW listing-heavy; shadow OBO top-ups |
| 2 | Latest offers | obo_owner | shadow_summary_vs_keyword_event_chunk | 0 | 0 | OBO profile by design |
| 3 | OBO activity | default | source_type_mismatch | 0 | 0 | KW listing×8 vs shadow OBO-heavy |
| 4 | OBO activity | obo_owner | shadow_summary_vs_keyword_event_chunk | 0 | 0 | Same split |
| 5 | Pricing/revision | default | source_type_mismatch | 0 | 0 | KW obo×8 vs shadow listing+revision |
| 7 | Catalog interest | default | keyword_exact_match_vs_shadow_semantic | 0 | 0 | KW includes revision; shadow listing monotype |
| 8 | Catalog interest | obo_owner | topup_diversity_not_overlap | 0 | 0 | OBO slots displace shared listings |
| 9 | Notifications | default | topup_diversity_not_overlap | 0 | 0 | **notification now in shadow** but not same chunks as KW obo×8 |
| 13 | Listing revisions | default | topup_diversity_not_overlap | 0 | 0 | **revision in shadow**; KW still obo×8 |
| 15 | Negotiation | default | same_source_type_different_chunks | 0 | 0 | Shared listing type, different listings |
| 16 | Negotiation | obo_owner | shadow_summary_vs_keyword_event_chunk | 0 | 0 | OBO/listing slot tradeoff |

---

## Aggregate reason table

### Built-in zero-overlap reasons (T20.10Z / T20.10AA)

| Reason | Count | Share of 11 zeros |
|--------|------:|------------------:|
| `same_source_type_different_chunks` | 10 | 91% |
| `source_type_mismatch` | 1 | 9% |

### T20.10AA audit classifications (11 zero-overlap runs)

| Classification | Count | Meaning |
|----------------|------:|---------|
| `topup_diversity_not_overlap` | 4 | T20.10Y added types; chunk IDs still differ |
| `shadow_summary_vs_keyword_event_chunk` | 4 | OBO-profile or cross-type mix vs keyword narrow chunks |
| `source_type_mismatch` | 2 | No shared primary source types (rows 3, 5) |
| `keyword_exact_match_vs_shadow_semantic` | 1 | Lexical keyword hits ≠ vector neighbors (row 7) |
| `same_source_type_different_chunks` | 1 | Pure listing listing-ID divergence (row 15) |

### Overlap-present runs (5/16)

| Pattern | Count | Interpretation |
|---------|------:|----------------|
| `obo_helper` + revision/OBO-themed query | 3 | Entity overlap 5–6 when profiles align |
| Mixed seller + offer/bid query | 2 | Partial chunk overlap (1–2) |

---

## Interpretation

### Not relevance failures

- **0/16** zero-result shadow runs on T20.10Z canonical benchmark.
- Leakage **0**; keyword summaries/refs **unchanged**.
- Shadow selections are **grounded** (8 chunks, valid source types, owner-scoped).

### Complementary retrieval (primary story)

Keyword retrieval optimizes **lexical query-term match** on the production path. Shadow retrieval optimizes **semantic similarity + route-weighted slot quotas + diversity top-ups**. On seller queries:

1. Keyword fills top-8 with **listing** (or **OBO** for offer/revision wording).
2. Shadow reserves slots for **OBO**, **listing_revision**, or **notification** per profile/T20.10Y top-ups.
3. Even when both include `listing`, they select **different listing documents** → zero chunk overlap with non-zero type overlap possible.

### T20.10W / T20.10Y impact on overlap

| Change | Overlap effect |
|--------|----------------|
| T20.10W scoped-first fetch | Reduced global fanout; **no chunk overlap improvement** |
| T20.10Y diversity top-ups | **Source diversity PASS**; shadow pools now include revision/notification |
| Entity overlap | **5/16** runs with entity_overlap>0 (unchanged band vs T20.10J) |
| Chunk overlap | **11/16** zero — **flat** vs T20.10J/T20.10Z pre-doc |

**Conclusion:** Diversity top-ups fix the **type-union gate**, not the **chunk-parity gate**.

### Safest refinement options (for T20.10AB proposal)

| Option | Safety | Expected overlap lift |
|--------|--------|----------------------|
| **Entity-aware shadow hints** (boost chunks sharing keyword `listing_id`/entity keys) | High — shadow-only rerank input | Medium for entity; low–medium for chunk |
| **Keyword-anchor diagnostic blend** (boost chunks matching keyword chunk/doc IDs in shadow rerank) | High — diagnostic path only | Medium on complementary runs |
| Chunk-level neighbor expansion (same doc, adjacent chunk_index) | Medium | Medium for revision queries |
| Metadata alias expansion | Low–medium — mostly done T20.10K–N | Entity only |
| Source-specific overlap top-ups | Medium — may hurt latency | Unknown |
| **No change — document complementary behavior** | Highest | None |
| Revert T20.10Y / global-first fetch | **Not recommended** — hurts latency/diversity | Would not fix lexical vs semantic gap |

**Do not change keyword retrieval** without explicit approval.

---

## Validation bundle (T20.10AA)

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | PASS harness — overlap 11/16 zero (confirmatory `221431`) |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL** (6 issues) — transient `obo_counter` keyword stability on fixture prompt; **real-query harness keyword rows unchanged** |
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (589 files) |

---

## Comparison to T20.10J (pre W/Y)

| Metric | T20.10J (`112818`) | T20.10AA (`215017`) |
|--------|-------------------:|--------------------:|
| Zero chunk-overlap | 11/16 | **11/16** (flat) |
| Built-in reasons | 8 same_type, 2 mismatch, 1 timeout | 10 same_type, 1 mismatch, **0 timeout** |
| entity-overlap >0 | 5/16 | **5/16** |
| Shadow types on notification query | listing+notification (default) | listing+notification+obo (**T20.10Y**) |

T20.10J embed timeout run excluded in T20.10Z+; overlap structure otherwise stable.

---

## Recommended next ticket

**T20.10AB — Shadow overlap refinement proposal (design-only)**

Scope for proposal (not implementation):

1. Entity-aware shadow hinting from keyword chunk entity keys
2. Keyword-anchor boost in shadow rerank (diagnostic only)
3. Explicit chunk-parity metrics separate from type-union gate
4. No keyword path changes without approval

Do **not** start T20.12 embedding tranches, T20.14/15 rollout, or Phase 21.

---

## Definition of done (T20.10AA)

- [x] 11/16 zero-overlap runs categorized
- [x] Root causes documented
- [x] No code changed
- [x] No generated artifacts committed
- [x] Next refinement path explicit (T20.10AB)
- [x] Vector rollout remains NOT APPROVED

**Vector rollout: NOT APPROVED**
