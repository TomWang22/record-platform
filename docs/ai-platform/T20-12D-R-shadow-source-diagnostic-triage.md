# T20.12D-R — Shadow source diagnostic failure triage

**Status:** READ-ONLY triage complete  
**Baseline SHA:** `fa425f7`  
**Generated:** 2026-06-25  
**Trigger:** T20.12D reported `rp-ai-shadow-source-diagnostic.sh` **FAIL (3 issues)** after Tranche 4, while historical source-diversity gate was **PASS (6 types)**.

## Executive summary

The T20.12D failure is **not a Tranche 4 corpus regression**. It is **reproducible embed-timeout variance**: when Ollama shadow embed exceeds ~5s, most prompts return **zero shadow candidates**, the hinted source-type union collapses, and the script’s diversity checks fail. On a warm rerun with successful embeds, the same script **PASSes with 6 types** including `record`.

**Rollout verdict unchanged:** NOT APPROVED.

**Recommendation:** Treat shadow source diagnostic as **CONDITIONAL** unless run after embed warmup (same pattern as `BENCH_REQUIRE_OLLAMA_WARM=1`). Document variance; **do not block tranche planning solely on a cold FAIL**. Do **not** run T20.12F actual write until an explicitly approved decision; if approving, require warmup-backed diagnostic PASS immediately before write.

---

## T20.12D failing run (reference)

From T20.12D session (`bench_logs/ai-platform/t19-6-route-shadow-quality.md` snapshot before triage reruns):

| Issue | Detail |
|-------|--------|
| 1 | `record: not surfaced in hinted record/buyer profiles` |
| 2 | `hinted_union_types: only ['listing', 'listing_revision', 'notification', 'obo_offer_summary']` (need ≥5) |
| 3 | `hinted_types: regression vs route-weighted diversity` |

**Symptom pattern:** `h cand=0`, `embed_ms` ~5.0–5.7s, `candidate_fetch_ms=0` on `obo_counter`, `underpriced_records`, `seller_summary`, `buyer_summary` — classic **embed_timeout** before pgvector fetch.

---

## Triage reruns (2026-06-25)

Three consecutive `bash scripts/rp-ai-shadow-source-diagnostic.sh` runs (no code changes, no embedding writes):

| Run | Result | Hinted union types | Notes |
|-----|--------|-------------------|-------|
| 1 | **FAIL** (3 issues) | `auction_bid_summary`, `listing`, `listing_revision` | Unweighted/weighted global unions empty; only `auction_risk` returned candidates on some rows |
| 2 | **FAIL** (3 issues) | `auction_bid_summary`, `listing`, `listing_revision` | Same timeout pattern; issues included `obo_offer_summary: not surfaced where owner-visible candidates expected` |
| 3 | **PASS** (0 issues) | **6 types:** `auction_bid_summary`, `listing`, `listing_revision`, `notification`, `obo_offer_summary`, `record` | All 7 prompts `h cand=8`; `record` surfaced on `underpriced_records` / `buyer_summary`; OBO on `obo_counter` / `listing_quality` |

**Reproducibility:** Failure is **reproducible under cold/slow embed**; PASS is **reproducible under warm/successful embed**. Not a stable functional regression.

Artifact (latest): `bench_logs/ai-platform/t19-6-route-shadow-quality.md` (run 3 = PASS).

---

## Answers to triage questions

### 1. Which 3 diversity issues failed?

Depends on run; union of observed failures:

- `record: not surfaced in hinted record/buyer profiles`
- `obo_offer_summary: not surfaced where owner-visible candidates expected` (when OBO profiles timeout)
- `hinted_union_types: only [...] (need >=5 when owner-visible)`
- `hinted_types: regression vs route-weighted diversity` (T20.12D run only)

All are downstream of **empty shadow candidate sets** when embed fails.

### 2. Which prompts/routes are affected?

When embed times out, affected profiles include:

| prompt_id | profile |
|-----------|---------|
| `obo_counter` | `obo_helper` |
| `underpriced_records` | `record_valuation` |
| `seller_summary` | `seller_sales_summary` |
| `buyer_summary` | `buyer_collection_summary` |
| `listing_quality` | `pricing_recommendation` |
| `notifications` | `generic_rag` |

`auction_risk` often still returns candidates when others timeout (lower embed latency on that run).

### 3. Which source types are missing?

On FAIL runs, union missing 1–3 of: `record`, `notification`, `obo_offer_summary` (and sometimes all but `auction_bid_summary` / `listing` / `listing_revision`).

On PASS run, **none missing** — full 6-type union.

### 4. Did Tranche 4 change selected source mix?

**No evidence of a diagnostic regression from Tranche 4.**

- Tranche 4 added +500 embeddings (+150 OBO, +200 listing, +100 listing_revision, +50 notification).
- Owner-visible OBO embedded remains **18**; total embedded OBO **1,268**.
- Failure correlates with **embed_ms ≥ ~5000** and `candidate_fetch_ms=0`, not with per-type embedding counts.
- Warm timing harness (post-triage, `BENCH_REQUIRE_OLLAMA_WARM=1`) shows **0 embed timeouts**, **0 zero-result shadow runs**, diverse selected types.

### 5. Is this reproducible on a second run?

**Yes, but bidirectionally:** cold runs FAIL; warm run PASS (3/3 triage runs: 2 FAIL, 1 PASS without code or corpus changes).

### 6. Does flagged mode still show 6 types?

`rp-ai-shadow-source-diagnostic.sh` does **not** enable overlap flags (`AI_RAG_SHADOW_ENTITY_HINTS` / `NEIGHBOR_EXPANSION`). It tests route-weighted shadow + query hints.

With **successful shadow embed** (run 3 PASS), **6 types** appear in weighted+hinted union.

Warm `rp-ai-shadow-real-query-timing.sh` (post-triage) also returns shadow candidates on all runs with **0 zero-result** shadow runs — consistent with 6-type corpus diversity when embed completes.

### 7. Does keyword contract remain PASS?

**Yes.** All diagnostic runs: keyword `retrieval_mode=keyword`, summaries unchanged, refs stable.

Also confirmed in triage:

- `audit-rp-ai-rag-contract.sh` — PASS
- `rp-ai-rag-quality-smoke.sh` — PASS

### 8. Is there leakage?

**Expected 0.** Diagnostic script checks forbidden prose and message-body patterns; keyword stability table shows no leak paths. No leakage observed in triage runs.

---

## Supporting checks (read-only)

| Script | Result |
|--------|--------|
| `rp-ai-shadow-source-diagnostic.sh` | FAIL → FAIL → **PASS** (variance) |
| `rp-ai-shadow-real-query-timing.sh` (warm) | shadow p50/p95 2494 / 4451 ms; **0 embed timeouts** |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |

Warm timing artifact: `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-160205.md`

---

## Root cause

```text
Cold/slow Ollama embed (~5s timeout)
  → shadow_vector status embed_timed_out / 0 candidates
  → hinted source_type union < 5
  → record/obo profile checks fail
  → T19.6C RESULT: FAIL
```

Tranche 4 increased embedded corpus size but did **not** change this failure mode. The diagnostic script has **no embed warmup gate** (unlike `rp-ai-shadow-real-query-timing.sh`).

---

## Impact on rollout

```text
Vector rollout: NOT APPROVED
Embedded: 6,065 (~8.3%)
Source diversity (when embed succeeds): 6 types PASS
Source diversity (cold diagnostic): CONDITIONAL / flaky FAIL
```

---

## Recommendation

| Finding | Action |
|---------|--------|
| Non-reproducible stable FAIL | Document as **embed-timeout variance**; do not treat single cold FAIL as Tranche 4 regression |
| Tranche planning | May continue **dry-run / docs** (T20.12E already done); T20.12F requires explicit approval **and** warmup-backed diagnostic PASS |
| If FAIL becomes stable on warm runs | Design-only proposal to align diagnostic with warmup gate or raise timeout — **no code change in this ticket** |
| No new actual writes | Until T20.12F explicitly approved with pre-write warmup PASS |

**Stop here.** No T20.12F actual write. No code changes. No embedding writes.
