# T20.29E — Participant-limited opt-in hybrid preview telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-01  
**Artifact:** `bench_logs/ai-platform/quality-telemetry/20260701161618.json` (not committed)

---

## 1. Participant audit

| Metric | Value |
|--------|------:|
| JWT participants | 12 |
| Opt-in enrollments (peak/window) | 11 |
| Post-eval revokes | 11 |
| UI enroll path | **PASS** (Playwright) |
| API bulk enroll (setup) | documented |

## 2. Soak telemetry (T20.29C)

| Metric | Value |
|--------|------:|
| `preview_opt_in` gate count | 1980 |
| `allowlist` gate count | 180 |
| `keyword_default` during soak | 0 |
| Fallback count | 0 |
| Hybrid p50 / p95 | 35.24 / 175.94 ms |
| Keyword p50 / p95 | 56.30 / 435.11 ms |
| Telemetry WARNs | 0 |
| Leakage | **PASS** |

## 3. UI / copy audit

| Check | Result |
|-------|--------|
| Forbidden production-default copy | **PASS** |
| Message-body exposure | **0** |
| Guest preview card hidden | **PASS** |

## 4. Verdict

```text
T20.29E: PASS
T20.29F: AUTHORIZED
```
