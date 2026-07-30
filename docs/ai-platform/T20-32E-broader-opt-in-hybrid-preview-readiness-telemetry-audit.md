# T20.32E — Broader opt-in hybrid preview readiness telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-02  
**Artifact:** `bench_logs/ai-platform/quality-telemetry/20260702170949.json` (not committed)

---

## 1. Soak summary (T20.32C)

| Metric | Value |
|--------|------:|
| Participants | 12 |
| Windows | 16 |
| Total cases | 8640 |
| `preview_opt_in` gate count | 7920 |
| `allowlist` gate count | 720 |
| Fallback count | 0 |
| Hybrid p50 / p95 | 38.7 / 180.36 ms |
| Keyword p50 / p95 | 60.83 / 442.38 ms |
| Avg / worst quality | 4.0 / 4.0 |
| `final_tagged_plan` fallback | 0 |
| Canary errors | 0 |
| Leakage | **PASS** |
| RP | **PASS** (`__SCANNED__=590`) |

## 2. Telemetry WARNs

| Phase | WARNs |
|-------|------:|
| Preflight (soak start) | **0** |
| Post-batch reporter | **0** |

Soak inference gates: **PASS**.

## 3. UI / copy audit

| Check | Result |
|-------|--------|
| Forbidden production-default copy | **PASS** |
| Message-body exposure | **0** |
| Guest preview card hidden | **PASS** |
| Source diagnostic | **FAIL (31 issues)** — report-only non-blocking |

## 4. Verdict

```text
T20.32E: PASS
T20.32F: AUTHORIZED
```
