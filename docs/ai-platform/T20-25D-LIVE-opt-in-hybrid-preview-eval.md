# T20.25D-LIVE — Opt-in hybrid preview eval

**Status:** Live eval **PASS**  
**Generated:** 2026-07-01  
**Implementation SHA:** `025d887`  
**Image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-25d-preview-eval/20260701-041033/summary.json`

---

## 1. Cohort and setup

| Email | Role | Enrollment |
|-------|------|------------|
| e2e-contract@record-platform.local | allowlist (KEEP) | not enrolled |
| t20-15g-cohort0@record-platform.local | preview cohort | enrolled via API |
| t20-15k-cohort1@record-platform.local | preview cohort | enrolled via API |
| buyer-contract@record-platform.local | preview cohort | enrolled via API |
| t20-15o-bucket10@record-platform.local | preview cohort | enrolled via API |
| t20-15s-bucket20@record-platform.local | preview cohort | enrolled via API |

`AI_RAG_HYBRID_CANARY_PERCENT=0` verified before and after.

## 2. Transcript design

| Dimension | Value |
|-----------|-------|
| Windows | 2 |
| Users | 6 |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total cases** | **540** |

## 3. Results

| Metric | Result | Gate |
|--------|--------|------|
| HTTP 200 | **540/540** | 540/540 **PASS** |
| Fallback rate | **0%** (0/540) | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality score | **4.0** | ≥3.5 **PASS** |
| Worst quality score | **4.0** | ≥3.0 **PASS** |
| Hybrid p50 / p95 | **43.4 / 214.1 ms** | p95 ≤3000 ms **PASS** |
| Keyword p50 / p95 | **64.1 / 371.0 ms** | informational |
| Canary errors | **0** | 0 **PASS** |
| Telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** (`__SCANNED__=590`) | **PASS** |
| Playwright | seller + record + longform **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |

### Per-user HTTP 200

All users **90/90** per window aggregate (2×5×9).

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 90 |
| `preview_opt_in` | 450 |
| `keyword_default` | 0 |

### `retrieval_mode` counts

| Mode | Count |
|------|------:|
| `hybrid_canary` | 540 |

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** — shadow p50/p95 157/441 ms; embed timeouts 0 |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (20 issues)** — known OBO/route diagnostic class (T20.19C non-blocking) |

Overlap (T20.19C baseline class): pure **8/16** report-only; anchored **16/16**; true zero-results **0**; embed timeouts **0**.

## 5. Preview enrollment status

- Before enroll: cohort0 already enrolled from preflight control; others `keyword_default`
- After enroll: 5 cohort users `preview_opt_in` / `owner_opt_in`
- Contract user remained not enrolled (`keyword_default` on status endpoint; `allowlist` on RAG)

## 6. Combined live total

Prior combined (through T20.21B): **2025/2025**  
This window: **540/540**  
**Cumulative: 2565/2565** HTTP 200, **0%** fallback

## 7. Verdict

```text
T20.25D-LIVE: PASS
T20.25E: AUTHORIZED
```
