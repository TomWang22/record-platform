# T20.14H1 — Hybrid vector 5-run stability eval

**Status:** Eval complete  
**Generated:** 2026-06-29  
**Deploy tag:** `python-ai-service:t20-p214g3r`  
**Baseline SHA:** `9f3f7cf` (H0 gate design)  
**Implementation SHA:** `cc3fb42` (G3R overlap tuning)

---

## Executive summary

Five consecutive warm shadow timing runs on G3R code show **stable hybrid gates**: anchored doc/entity overlap **16/16** on every run, true zero-results **0/16**, embed timeouts **0**, latency **PASS** on all runs. **Pure vector overlap remains 8/16** on every run — Lane A continues to FAIL.

Run 5 shows a cold-embed tail (shadow p95 **1351 ms**) similar to G3R run 1; still well under the **3000 ms** SLO. Runs 1–4 are cache-hot (~**93–109 ms** shadow p95).

Product suites, contracts, source diagnostic, and leakage checks **PASS**. Telemetry **0 WARNs**.

**H2 recommendation input:** Hybrid canary **design** may proceed to owner approval; pure vector rollout remains **NOT APPROVED**.

---

## Pre-flight verification

| Check | Result |
| ----- | ------ |
| Cluster pods | All Running |
| Deploy image | `python-ai-service:t20-p214g3r` |
| Embedded chunks | **10065** |
| HNSW index | `ai_document_chunks_embedding_vec_hnsw_idx` present |
| shopping-service | 1/1 Ready (from baseline) |

---

## Stability table

| Metric | Required | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Verdict |
| ------ | -------- | ----: | ----: | ----: | ----: | ----: | ------- |
| shadow p95 ms | ≤3000 | **108.8** | **92.5** | **92.8** | **94.2** | **1351.0** | **PASS** |
| candidate_fetch p95 ms | ≤1500 | **52.5** | **49.5** | **49.0** | **51.2** | **55.5** | **PASS** |
| embed timeouts | 0 | **0** | **0** | **0** | **0** | **0** | **PASS** |
| true zero-results | 0/16 | **0/16** | **0/16** | **0/16** | **0/16** | **0/16** | **PASS** |
| pure doc/entity overlap >0 | report, target ≥10/16 | **8/16** | **8/16** | **8/16** | **8/16** | **8/16** | **FAIL** |
| anchored doc/entity overlap >0 | ≥10/16 | **16/16** | **16/16** | **16/16** | **16/16** | **16/16** | **PASS** |
| overlap anchors added | report | **8/16** | **8/16** | **8/16** | **8/16** | **8/16** | info |
| entity expansion added | report | **6/16** | **6/16** | **6/16** | **6/16** | **6/16** | info |
| source diagnostic | PASS | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| product telemetry WARNs | 0 | **0** | **0** | **0** | **0** | **0** | **PASS** |
| leakage | PASS | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |

### Run artifacts (local only — not committed)

| Run | Report |
| --- | ------ |
| 1 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-122813.md` |
| 2 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-122827.md` |
| 3 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-122837.md` |
| 4 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-122847.md` |
| 5 | `bench_logs/ai-platform/t20-10-shadow-real-query-20260629-122856.md` |

---

## Validation bundle

| Script | Result |
| ------ | ------ |
| `rp-ai-shadow-source-diagnostic.sh` | PASS (0 issues) |
| `audit-rp-ai-rag-contract.sh` | PASS |
| `rp-ai-rag-quality-smoke.sh` | PASS |
| `audit-rp-ai-runtime-contract.sh` | PASS |
| `audit-rp-ai-endpoints-contract.sh` | PASS |
| `rp-ai-provider-readiness.sh` | PASS |
| `rp-ai-pgvector-readiness.sh` | PASS |
| `rp-rp-decontaminate-scan.sh` | PASS |

## Product suites

| Suite | Result |
| ----- | ------ |
| Seller intelligence UI | PASS |
| AI record intelligence UI | PASS (avg score 3.86, leakage PASS) |
| AI longform record session | PASS (12/12, avg 3.67, p95 UI 1759 ms) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** |

---

## Decision rules applied

| Rule | Outcome |
| ---- | ------- |
| Pure overlap ≥10/16 on all 5 runs → pure vector canary planning | **Not met** (8/16 all runs) |
| Pure <10/16 but anchored ≥10/16 on all 5 runs → hybrid canary design only | **Met** |
| Latency, zero-results, product, or leakage fail → no T20.15 | **Not triggered** — all PASS |

---

## Stability notes

- **Pure overlap plateau:** 8/16 unchanged across G3 (3-run), G3R (3-run), and H1 (5-run). Eight prompts consistently require overlap anchors; entity expansion alone does not bridge them.
- **Anchor consistency:** `overlap_anchor_added` fires on **8/16** every run — deterministic for the fixed 16-case matrix (8 queries × 2 modes).
- **Latency variance:** Run 5 shadow p95 **1351 ms** is embed-cold tail, not anchor regression (cf p95 **55.5 ms**). Worst-case still **PASS** under 3000 ms gate.
- **No keyword production change:** Lane C unchanged; all shadow work is diagnostics-only.

---

## H1 verdict

```text
Lane A (pure vector): FAIL — 8/16 stable across 5 runs
Lane B (hybrid anchored): PASS — 16/16 stable across 5 runs
Lane C (keyword production): PASS
H1 hybrid stability: PASS (latency, zero-results, product, leakage)
Pure vector rollout: NOT APPROVED
T20.15: BLOCKED — proceed to H2 decision package only
```
