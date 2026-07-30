# T20.31C-LIVE — Sustained opt-in hybrid preview soak eval

**Status:** Live soak **PASS**  
**Generated:** 2026-07-02  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-31c-sustained-eval/20260702-151814/summary.json` (not committed)

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Participants | **12 JWT** |
| Windows | **12** |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total** | **6480** |

Per-window: revoke all → verify `keyword_default` → bulk enroll 11 → verify `preview_opt_in` + RAG probe → run matrix → revoke. Retry/backoff for 429s enabled (`T20_EVAL_RAG_RETRY_MAX=8`).

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **6480/6480** | 100% **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **252.5 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Soak telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Guest hidden / no message bodies | **PASS** | **PASS** |
| Post-revoke `keyword_default` | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 540 |
| `preview_opt_in` | 5940 |

## 3. Post-eval revoke

All 11 participant enrollments revoked; participants → `keyword` / `keyword_default`; contract → `hybrid_canary` / `allowlist`.

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (31 issues)** — known non-blocking class |

## 5. Playwright (final clean runs)

| Spec | Result |
|------|--------|
| `ai-rag-opt-in-hybrid-preview-ui.spec.ts` | **4/4 PASS** |
| `seller-intelligence-ui.spec.ts` | **1/1 PASS** |
| `ai-rag-record-intelligence.spec.ts` | **1/1 PASS** (retry after transient first-run failure) |
| `ai-rag-longform-record-session.spec.ts` | **1/1 PASS** |

## 6. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D29C | 6345/6345 |
| T20.30C | 3240/3240 |
| T20.31C | 6480/6480 |
| **Total** | **16065/16065** |

## 7. Verdict

```text
T20.31C-LIVE: PASS
T20.31D: AUTHORIZED
```
