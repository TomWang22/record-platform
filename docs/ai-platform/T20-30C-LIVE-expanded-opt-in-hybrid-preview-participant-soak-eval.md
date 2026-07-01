# T20.30C-LIVE — Expanded opt-in hybrid preview participant soak eval

**Status:** Live soak **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-30c-expanded-eval/20260701-222700/summary.json`

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Participants | **12 JWT** |
| Windows | **6** |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total** | **3240** |

Enrollment: API bulk per window (UI enroll/revoke verified in Playwright). Retry/backoff for 429s enabled.

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **3240/3240** | 100% **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **193.41 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Soak telemetry WARNs (preflight) | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| OCH | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Post-revoke `keyword_default` | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 270 |
| `preview_opt_in` | 2970 |

## 3. Post-eval revoke

All 11 participant enrollments revoked; participants → `keyword` / `keyword_default`; contract → `hybrid_canary` / `allowlist`.

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (20 issues)** — known non-blocking class |

## 5. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D29C | 6345/6345 |
| T20.30C | 3240/3240 |
| **Total** | **9585/9585** |

## 6. Verdict

```text
T20.30C-LIVE: PASS
T20.30D: AUTHORIZED
```
