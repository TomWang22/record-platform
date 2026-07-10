# T20.14G2 — Shadow overlap v2 eval (3-run)

**Status:** Eval complete  
**Generated:** 2026-06-29  
**Deploy tag:** `python-ai-service:t20-p214g2`  
**Baseline SHA:** `08be7d7` (G2 implementation)  
**F2 comparison baseline:** T20.14F2 (`352fa2d`)

---

## Executive summary

G2 **eliminated true zero-results** (0/16 on all three runs vs F2 **2/16**) via source-type floor + zero-result fallback. Doc/entity overlap improved from **5/16 → 7/16** but remains below the **≥10/16** stability target. **Latency regressed** vs F2 on runs 1–2 (shadow p95 **6779 / 6158 ms**; run 2 cf p95 **3241 ms**). Run 3 is cache-warm and near gate (shadow p95 **3153 ms**, cf **1011 ms**).

Keyword production, contracts, Playwright, and leakage checks **PASS**. Product telemetry reports **1 WARN** (`ui_latency_p95_ms` 22406 > 15000 — transient longform turn 1 UI spike).

```text
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3 entity expansion v2 (overlap) AND latency cap tuning / rollback review before T20.14H
```

---

## Timing table

| Metric | F2 baseline | Run 1 | Run 2 | Run 3 | Verdict |
| ------ | ----------: | ----: | ----: | ----: | ------- |
| shadow p95 (ms) | 1494 / 376 / 1317 | **6779** | **6158** | **3153** | **FAIL** (runs 1–2; run 3 borderline >3000) |
| candidate_fetch p95 (ms) | 557 / 205 / 532 | **1251** | **3241** | **1011** | **FAIL** run 2 vs ≤1500; PASS runs 1 & 3 |
| embed timeouts | 0 | 0 | 0 | 0 | **PASS** |
| true zero-results | 2/16 | **0/16** | **0/16** | **0/16** | **PASS** |
| true zero after fallback | n/a | **0/16** | **0/16** | **0/16** | **PASS** |
| doc overlap >0 | 5/16 | **7/16** | **7/16** | **7/16** | **FAIL** (<10/16; improved) |
| entity overlap >0 | 5/16 | **7/16** | **7/16** | **7/16** | **FAIL** (<10/16; improved) |
| keyword anchors added | n/a | **1/16** | **1/16** | **1/16** | info |
| fallback applied | n/a | **1/16** | **1/16** | **1/16** | info |
| source diagnostic | PASS | PASS | PASS | PASS | **PASS** |
| product telemetry WARNs | 0 | **1** | — | — | **WARN** |
| leakage | PASS | PASS | PASS | PASS | **PASS** |

### Run artifacts (local only — not committed)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-000631.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-000911.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-001102.md` |

---

## Zero-result and fallback analysis

F2 stable **2/16** true zero-results on `shadow_default` / `seller_sales_summary`:

1. *Summarize listing activity and buyer interest for my catalog this week* — typed pool empty
2. *What notifications matter most for my selling activity right now?* — typed pool empty

G2 outcomes (consistent across all three runs):

| Query | G2 fix path | shadow_default selected | entity overlap |
| ----- | ----------- | ----------------------: | -------------: |
| Catalog this week | `source_type_floor` + global retry + **keyword anchor K=2** | 2 (was 0) | **4** (was 0) |
| Notifications | `source_type_floor` + **OBO as notification evidence** (no anchor) | 8 (was 0) | **6** (was 0) |

Telemetry observed on catalog fallback (all runs):

- `zero_result_fallback_stage`: `global_untyped_retry`
- `keyword_anchor_count`: 2
- `fallback_reason`: `zero_result_fallback_applied`
- `true_zero_result_after_fallback`: false

Chunk overlap remains weak (**9/16** zero-overlap unchanged); doc/entity gains come from anchor + floor paths.

---

## Latency regression note

G2 adds shadow-only work on zero-result paths (global untyped retry, source-type floor fanout, keyword anchor merge). F2 had already cleared latency gates with HNSW; G2 runs 1–2 show **embed tail variance** (run 1 embed p95 **4339 ms**, 1 outlier ≥5s) driving shadow p95 above 3000 ms. Run 3 embed cache-hot (embed p95 **1587 ms**) brings shadow near gate but still **3153 ms**.

**Recommendation:** Do not proceed to T20.14H until latency stabilizes. Options:

1. Cap global fallback fanout / defer floor until after first typed fetch times out cheaply
2. Roll back deploy tag to `t20-p214f2` for latency baseline while iterating G3 overlap logic offline
3. Re-run G2 eval after embed warm-cache stabilization (not sufficient alone — run 3 still borderline)

---

## Contract and product validation

| Check | Result |
| ----- | ------ |
| `rp-ai-shadow-source-diagnostic.sh` | PASS |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-och-decontaminate-scan.sh` | PASS |
| Seller intelligence Playwright | PASS 4/4 |
| Record intelligence Playwright | PASS 7/7 avg 3.86 |
| Longform session Playwright | PASS 12/12 avg 3.67 |
| `ai-quality-telemetry-report.mjs` | **1 WARN** (`ui_latency_p95_ms`) |

Keyword retrieval remains default; no vector default, overlap production flags, DB index changes, or Phase 21 product behavior changes.

---

## Decision

| Criterion | Met? |
| --------- | ---- |
| True zero-results → 0/16 | **Yes** |
| Doc/entity overlap ≥10/16 | **No** (7/16) |
| Latency gates (shadow ≤3000, cf ≤1500 all runs) | **No** |
| Rollout approval | **No** |

Per G2 eval rules:

- Zero-results fixed and overlap improved but **<10/16** → **T20.14G3 entity expansion v2**
- Latency regressed vs F2 → **cap tuning or rollback** before T20.14H 5-run stability
- Do **not** approve vector rollout

---

## Final verdict

```text
T20.14G2 shadow overlap v2 eval: COMPLETE
True zero-results: PASS (0/16)
Overlap: IMPROVED but FAIL (7/16 doc/entity)
Latency: FAIL vs F2 (runs 1–2; run 3 borderline)
Vector rollout: NOT APPROVED
T20.15: BLOCKED
Recommended next: T20.14G3 entity expansion v2 OR T20.14H 5-run stability (only after latency re-PASS)
```
