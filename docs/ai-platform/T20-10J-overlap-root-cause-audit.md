# T20.10J — Shadow/keyword overlap root-cause audit

**Generated:** 2026-06-23  
**Accepted main:** `66c1573` (external Ollama warmup gate)  
**Mode:** read-only diagnostics — no ranking, keyword, or vector-default changes

## Benchmark artifact

- Summary: `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-112818.md`
- Raw JSONL: `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-112818.jsonl`
- Warmup: `BENCH_REQUIRE_OLLAMA_WARM=1`, `BENCH_WARMUP_RUNS=1`

### Aggregate overlap summary

| Metric | Value |
|--------|------:|
| Shadow runs (measured) | 16 |
| Zero chunk-overlap | **11/16** |
| Doc-overlap >0 | **5/16** |
| Entity-overlap >0 | **5/16** |
| Zero-result shadow | **1/16** (embed timeout) |
| Embed timeouts | **1** |
| Shadow p50 / p95 | 2940 / 7034 ms |
| Embed p50 / p95 | 1169 / 4145 ms |

### Built-in zero-overlap reason distribution

| Reason | Count |
|--------|------:|
| `same_source_type_different_chunks` | 8 |
| `source_type_mismatch` | 2 |
| `unknown` (embed timeout) | 1 |

### Audit classification (zero-overlap runs only)

| Classification | Count | Interpretation |
|----------------|------:|----------------|
| `shadow_complementary_but_different` | 7 | Shadow surfaces OBO + listing mix while keyword stays listing-heavy on shared queries |
| `source_type_mismatch` | 2 | Keyword OBO-only vs shadow listing/revision — no shared source types |
| `keyword_unembedded_equivalent_missing` | 1 | Keyword uses `listing_revision` chunks shadow did not place in top-8 |
| `provider_latency_artifact` | 1 | Embed timeout → empty shadow selection; not a ranking signal |

Overlap-present runs (5/16): chunk overlap 1–3 with doc/entity overlap on 5 runs — acceptable parity when paths align.

---

## Table — all 16 shadow runs

| # | Mode | Profile | Query (truncated) | Chunk | Doc | Entity | Built-in reason | Audit class | Quality note |
|---|------|---------|-------------------|------:|----:|-------:|-----------------|-------------|--------------|
| 1 | shadow_default | seller_sales_summary | Summarize the latest offers I have received… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Shadow adds OBO; keyword listing+revision |
| 2 | shadow_obo_owner | obo_helper | Summarize the latest offers… | 0 | 0 | 0 | unknown | provider_latency_artifact | **Invalid** — embed timeout, 0 selected |
| 3 | shadow_default | seller_sales_summary | Give me an owner-visible summary of OBO… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Keyword listing-only vs shadow 6 OBO + 2 listing |
| 4 | shadow_obo_owner | obo_helper | Give me an owner-visible summary of OBO… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Same split; OBO profile by design |
| 5 | shadow_default | seller_sales_summary | What are the most recent pricing or revision… | 0 | 0 | 0 | source_type_mismatch | source_type_mismatch | Keyword OBO-only vs shadow listing+revision |
| 6 | shadow_obo_owner | obo_helper | What are the most recent pricing or revision… | 3 | 3 | 6 | — | overlap_present | **Good parity** — shared OBO entities/docs |
| 7 | shadow_default | seller_sales_summary | Summarize listing activity and buyer interest… | 0 | 0 | 0 | same_source_type_different_chunks | keyword_unembedded_equivalent_missing | Keyword has revisions shadow omitted |
| 8 | shadow_obo_owner | obo_helper | Summarize listing activity and buyer interest… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Listing+revision keyword vs OBO-heavy shadow |
| 9 | shadow_default | seller_sales_summary | What notifications matter most… | 0 | 0 | 0 | source_type_mismatch | source_type_mismatch | Keyword OBO-only vs shadow listing+notification |
| 10 | shadow_obo_owner | obo_helper | What notifications matter most… | 1 | 1 | 2 | — | overlap_present | Partial parity on shared OBO path |
| 11 | shadow_default | seller_sales_summary | Show a concise summary of bidding and offer… | 1 | 1 | 2 | — | overlap_present | Partial parity |
| 12 | shadow_obo_owner | obo_helper | Show a concise summary of bidding and offer… | 2 | 2 | 3 | — | overlap_present | Strong entity overlap |
| 13 | shadow_default | seller_sales_summary | What changed recently on listing revisions… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Keyword OBO-only vs mixed shadow |
| 14 | shadow_obo_owner | obo_helper | What changed recently on listing revisions… | 2 | 2 | 3 | — | overlap_present | Strong entity overlap |
| 15 | shadow_default | seller_sales_summary | Summarize my private seller-side negotiation… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | Listing keyword vs OBO+listing shadow |
| 16 | shadow_obo_owner | obo_helper | Summarize my private seller-side negotiation… | 0 | 0 | 0 | same_source_type_different_chunks | shadow_complementary_but_different | OBO profile mix vs listing keyword |

---

## Table — zero-overlap runs only (11)

| # | Mode | Profile | Query | Doc | Entity | Keyword types | Shadow types | Built-in | Audit class |
|---|------|---------|-------|----:|-------:|---------------|--------------|----------|-------------|
| 1 | shadow_default | seller_sales_summary | Latest offers received… | 0 | 0 | listing×7, listing_revision×1 | listing×5, obo_offer_summary×3 | same_source_type_different_chunks | shadow_complementary_but_different |
| 2 | shadow_obo_owner | obo_helper | Latest offers received… | 0 | 0 | — | — | unknown | provider_latency_artifact |
| 3 | shadow_default | seller_sales_summary | OBO activity summary… | 0 | 0 | listing×8 | listing×2, obo×6 | same_source_type_different_chunks | shadow_complementary_but_different |
| 4 | shadow_obo_owner | obo_helper | OBO activity summary… | 0 | 0 | listing×8 | listing×2, obo×6 | same_source_type_different_chunks | shadow_complementary_but_different |
| 5 | shadow_default | seller_sales_summary | Pricing/revision changes… | 0 | 0 | obo×8 | listing×5, listing_revision×3 | source_type_mismatch | source_type_mismatch |
| 6 | shadow_default | seller_sales_summary | Listing activity / buyer interest… | 0 | 0 | listing×6, listing_revision×2 | listing×2, obo×6 | same_source_type_different_chunks | keyword_unembedded_equivalent_missing |
| 7 | shadow_obo_owner | obo_helper | Listing activity / buyer interest… | 0 | 0 | listing×6, listing_revision×2 | listing×2, obo×6 | same_source_type_different_chunks | shadow_complementary_but_different |
| 8 | shadow_default | seller_sales_summary | Notifications matter most… | 0 | 0 | obo×8 | listing×6, notification×2 | source_type_mismatch | source_type_mismatch |
| 9 | shadow_default | seller_sales_summary | Listing revisions / offer conversion… | 0 | 0 | obo×8 | listing×2, listing_revision×3, obo×3 | same_source_type_different_chunks | shadow_complementary_but_different |
| 10 | shadow_default | seller_sales_summary | Private seller negotiation… | 0 | 0 | listing×8 | listing×5, obo×3 | same_source_type_different_chunks | shadow_complementary_but_different |
| 11 | shadow_obo_owner | obo_helper | Private seller negotiation… | 0 | 0 | listing×8 | listing×2, obo×6 | same_source_type_different_chunks | shadow_complementary_but_different |

Chunk IDs are available per run in JSONL `shadow_diagnostics.overlap.keyword_ids` / `shadow_ids` for deeper corpus forensics.

---

## Qualitative interpretation

### Top 3 root causes

1. **Shadow complementary source mix (7/11 zero-overlap)** — On seller queries, keyword retrieval ranks **listing-heavy** (often 7–8 listing chunks). Shadow default/inferred profiles intentionally reserve slots for **`obo_offer_summary`** (typically 3–6 chunks). Shared source type is `listing`, but **zero shared documents/entities** because keyword and shadow pick **different listings** within the same type. This is not a bug in overlap math; it reflects **different ranking objectives**.

2. **Source-type path divergence (2/11)** — For revision/notification queries, keyword returns **OBO-only** top-8 while shadow returns **listing + listing_revision** or **listing + notification**. No shared source types → chunk overlap impossible without changing keyword or shadow routing.

3. **Provider latency artifact (1/11)** — One `shadow_obo_owner` run hit **embed timeout** (5816 ms) with **0 candidates**. Excluded from ranking quality assessment; addressed by preflight-B warmup gate discipline, not ranking patches.

### Secondary finding

- **Keyword revision gap (1/11):** One run shows keyword selecting `listing_revision` chunks that shadow did not rank in top-8 while both share `listing` type — suggests **metadata/chunk granularity** or **revision-specific ranking** gap, not pure OBO/listing tradeoff.

### What is *not* the primary cause

- Privacy leakage or owner-scope filtering — no blocked counts in diagnostics.
- Empty corpus — all successful runs selected 8 chunks.
- Low embedding coverage alone — overlap-present runs prove vector path works when types align.

---

## Recommendation

**Do not apply another generic ranking patch yet.**

| Option | Verdict |
|--------|---------|
| Targeted ranking patch | **Defer** — 7/11 zeros are complementary-type tradeoffs, not clear shadow-worse cases |
| Corpus/metadata repair | **Investigate** — revision chunks and listing_id entity linkage may improve doc/entity overlap without forcing chunk-id match |
| Another bounded tranche dry-run | **Not now** — coverage still 7.62%; overlap issue is mostly path divergence not missing embeddings |
| Accept low chunk-overlap if doc/entity parity OK | **Partially yes** — 5/16 runs show doc+entity overlap; evaluate rollout on **entity/doc parity** metrics, not chunk-id match alone |
| Add richer metadata first | **Preferred next step** — strengthen `listing_id` / `offer_id` cross-linking in chunks so entity overlap is measurable when semantically same |

### Code change justified?

**No ranking code change justified** from this audit alone.

Continue using **preflight-B external warmup gate** for benchmarks. If Phase 20 proceeds, open a **metadata/entity-linking** ticket (not T20.10K ranking tuning) before any further shadow weight changes.

---

## Validation

| Check | Result |
|-------|--------|
| OCH scan | **PASS** |
| T20.10I product changes | **Reverted** — main at `66c1573` |
| Benchmark artifacts | **Not committed** |

## Vector rollout

**NOT APPROVED** — overlap gate still fails on chunk-id metric (11/16 zero), but audit shows many zeros are **complementary retrieval** not shadow failure.
