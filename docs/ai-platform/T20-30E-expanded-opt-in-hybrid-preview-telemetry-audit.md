# T20.30E — Expanded opt-in hybrid preview telemetry audit

**Status:** Telemetry audit **PASS** (soak inference); post-Playwright UI latency note  
**Generated:** 2026-07-01  
**Artifact:** `bench_logs/ai-platform/quality-telemetry/20260701224649.json` (not committed)

---

## 1. Soak summary (T20.30C)

| Metric | Value |
|--------|------:|
| Participants | 12 |
| Windows | 6 |
| Total cases | 3240 |
| `preview_opt_in` gate count | 2970 |
| `allowlist` gate count | 270 |
| Fallback count | 0 |
| Hybrid p50 / p95 | 35.24 / 193.41 ms |
| Keyword p50 / p95 | 56.30 / 435.11 ms |
| Avg / worst quality | 4.0 / 4.0 |
| `final_tagged_plan` fallback | 0 |
| Canary errors | 0 |
| Leakage | **PASS** |
| RP | **PASS** (`__SCANNED__=589`) |

## 2. Telemetry WARNs

| Phase | WARNs |
|-------|------:|
| Preflight (soak start) | **0** |
| Post-batch reporter | **1** (`ui_latency_p95_ms` = 16493 ms from longform Playwright — UI latency class, non-RAG) |

Soak inference gates: **PASS**. Post-Playwright UI p95 exceeds 15000 ms threshold due to longform E2E walkthrough; classified non-blocking per prior soak batches.

## 3. UI / copy audit

| Check | Result |
|-------|--------|
| Forbidden production-default copy | **PASS** |
| Message-body exposure | **0** |
| Guest preview card hidden | **PASS** |
| Source diagnostic | **FAIL (20 issues)** — report-only non-blocking |

## 4. Verdict

```text
T20.30E: PASS
T20.30F: AUTHORIZED
```
