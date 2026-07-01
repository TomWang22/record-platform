# T20.28E — Opt-in hybrid preview post-UI telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-01  
**Artifact:** `bench_logs/ai-platform/quality-telemetry/20260701153000.json` (not committed)

---

## 1. Telemetry summary

| Check | Result |
|-------|--------|
| Telemetry WARNs | **0** |
| Record scenario score | **3.86** |
| Longform scenario score | **3.67** |
| Final turn score | **4.0** |
| Leakage | **PASS** |
| OCH scan | **PASS** (`__SCANNED__=589`) |

## 2. Soak gate evidence (T20.28C)

| Metric | Value |
|--------|------:|
| `preview_opt_in` gate count | 900 |
| `allowlist` gate count | 180 |
| Fallback count | 0 |
| Canary errors | 0 |
| Hybrid p50 / p95 | 55.33 / 254.75 ms |
| Keyword p50 / p95 | 70.15 / 533.57 ms |
| Avg source refs (implicit) | present on all cases |

## 3. UI / copy audit

| Check | Result |
|-------|--------|
| No message-body fields in UI | **PASS** (Playwright + leakage regex) |
| No production-default copy | **PASS** |
| No percentage rollout controls | **PASS** |
| Preview enroll/revoke API paths only | **PASS** |

## 4. Verdict

```text
T20.28E: PASS
T20.28F: AUTHORIZED
```
