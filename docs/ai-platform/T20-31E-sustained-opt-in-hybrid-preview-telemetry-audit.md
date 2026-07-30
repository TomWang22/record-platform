# T20.31E — Sustained opt-in hybrid preview telemetry audit

**Status:** Telemetry audit **PASS** (soak inference); post-Playwright UI latency note  
**Generated:** 2026-07-02  
**Artifact:** `bench_logs/ai-platform/quality-telemetry/20260702155903.json` (not committed)

---

## 1. Soak summary (T20.31C)

| Metric | Value |
|--------|------:|
| Participants | 12 |
| Windows | 12 |
| Total cases | 6480 |
| `preview_opt_in` gate count | 5940 |
| `allowlist` gate count | 540 |
| Fallback count | 0 |
| Hybrid p50 / p95 | 45.3 / 252.5 ms |
| Keyword p50 / p95 | 66.78 / 508.97 ms |
| Avg / worst quality | 4.0 / 4.0 |
| `final_tagged_plan` fallback | 0 |
| Canary errors | 0 |
| Leakage | **PASS** |
| RP | **PASS** (`__SCANNED__=590`) |

## 2. Telemetry WARNs

| Phase | WARNs |
|-------|------:|
| Preflight (soak start) | **1** (`ui_latency_p95_ms` — prior longform Playwright; non-soak) |
| Post-batch reporter | **1** (`ui_latency_p95_ms` — UI latency class, non-RAG) |

Soak inference gates: **PASS**. UI p95 WARN classified non-blocking per prior soak batches.

## 3. UI / copy audit

| Check | Result |
|-------|--------|
| Forbidden production-default copy | **PASS** |
| Message-body exposure | **0** |
| Guest preview card hidden | **PASS** |
| Source diagnostic | **FAIL (31 issues)** — report-only non-blocking |

## 4. Verdict

```text
T20.31E: PASS
T20.31F: AUTHORIZED
```
