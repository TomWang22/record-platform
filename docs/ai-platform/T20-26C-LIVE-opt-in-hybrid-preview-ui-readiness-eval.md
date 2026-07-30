# T20.26C-LIVE — Opt-in hybrid preview UI readiness eval

**Status:** Live smoke **PASS**  
**Generated:** 2026-07-01  
**Baseline SHA:** `2aad8bd`  
**Image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-25d-preview-eval/` (latest 1-window run)

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Windows | 1 |
| Users | 6 |
| Runs / user | 5 |
| Cases / run | 9 |
| **Total** | **270** |

## 2. Setup

- Revoked all existing preview enrollments before eval
- Verified cohort users `keyword` / `keyword_default`
- Enrolled 5 cohort users via `POST /api/ai/rag/preview/enroll`
- Contract user: not enrolled; RAG remains `allowlist`

## 3. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **270/270** | 270/270 **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **154.9 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Playwright | seller + record + longform **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count | Expected |
|---------------|------:|----------|
| `allowlist` | 45 | 45 **PASS** |
| `preview_opt_in` | 225 | 225 **PASS** |

## 4. Post-eval revoke

All cohort enrollments revoked. Cohort users → `keyword` / `keyword_default`. Contract → `hybrid_canary` / `allowlist`.

## 5. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** — shadow p50/p95 ~35/155 ms class |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (issues)** — known OBO/route class; non-blocking per T20.19C |

Overlap: pure **8/16** report-only; anchored **16/16** (≥10/16 hard min **PASS**).

## 6. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D25D | 2565/2565 |
| T20.26C | 270/270 |
| **Total** | **2835/2835** HTTP 200, **0%** fallback |

## 7. Verdict

```text
T20.26C-LIVE: PASS
T20.26D: AUTHORIZED
```
