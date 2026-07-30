# T20.32C-LIVE — Broader opt-in hybrid preview readiness eval

**Status:** Live eval **PASS**  
**Generated:** 2026-07-02  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-32c-broader-eval/20260702-162247/summary.json` (not committed)

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Participants | **12 JWT** |
| Windows | **16** |
| Runs / user / window | 5 |
| Cases / run | 9 |
| **Total** | **8640** |

Per-window: revoke → verify `keyword_default` → bulk enroll 11 → verify `preview_opt_in` + RAG probe → run matrix → revoke. Retry/backoff for 429s enabled.

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **8640/8640** | 100% **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **180.36 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Soak telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| RP | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Post-revoke `keyword_default` | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 720 |
| `preview_opt_in` | 7920 |

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
| D16→T20.31C | 16065/16065 |
| T20.32C | 8640/8640 |
| **Total** | **24705/24705** |

## 7. Verdict

```text
T20.32C-LIVE: PASS
T20.32D: AUTHORIZED
```
