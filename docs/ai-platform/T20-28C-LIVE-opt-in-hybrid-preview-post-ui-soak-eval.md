# T20.28C-LIVE — Opt-in hybrid preview post-UI soak eval

**Status:** Live soak **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-25d-preview-eval/20260701-152330/summary.json`

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Windows | 4 |
| Users | 6 |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total** | **1080** |

Per-window setup: revoke all → verify `keyword_default` → API enroll 5 cohort users → verify `allowlist` + `PERCENT=0`.

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **1080/1080** | 1080/1080 **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **254.75 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Playwright (preview + seller + record + longform) | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Post-revoke `keyword_default` | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 180 |
| `preview_opt_in` | 900 |

## 3. Post-eval revoke

All cohort enrollments revoked; cohort → `keyword` / `keyword_default`; contract → `hybrid_canary` / `allowlist`.

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (20 issues)** — known non-blocking class |

Anchored overlap **16/16** class; pure **8/16** report-only.

## 5. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D27E | 3105/3105 |
| T20.28C | 1080/1080 |
| **Total** | **4185/4185** |

## 6. Verdict

```text
T20.28C-LIVE: PASS
T20.28D: AUTHORIZED
```
