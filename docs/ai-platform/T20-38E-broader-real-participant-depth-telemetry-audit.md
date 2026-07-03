# T20.38E — Broader real-participant depth telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-03  
**Soak artifact:** `bench_logs/ai-platform/t20-38c-broader-real-participant-depth-eval/20260703-160630/summary.json` (not committed)  
**Telemetry:** `bench_logs/ai-platform/quality-telemetry/20260703163246.json` (not committed)

---

## 1. Participant summary

| Metric | Value |
|--------|------:|
| Artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` (unchanged) |
| Complete participants | **3** (1× real_owner_approved, 2× internal_staff) |
| T20.38C live cases | **4320** |
| Cumulative live | **33345/33345** |

## 2. Soak telemetry

| Metric | Value |
|--------|------:|
| HTTP 200 | **4320/4320** |
| Fallback | **0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p50 / p95 | **39.26 / 151.42 ms** |
| Keyword p50 / p95 | **63.58 / 443.11 ms** |
| Canary errors | **0** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Gate: preview_opt_in | **3240** |
| Gate: allowlist | **1080** |
| keyword_default during matrix | **0** |

## 3. OCH / UI

| Check | Result |
|-------|--------|
| OCH | **PASS** (`__SCANNED__=589`) |
| Guest preview hidden | **PASS** (Playwright) |
| Message-body exposure | **0** |
| Playwright C-suite | **7/7 PASS** |

## 4. Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL** (20 issues, OBO/route) — report-only.

## 5. Cumulative live evidence

```text
Prior (D16→T20.37C): 29025/29025 HTTP 200, 0% fallback
T20.38C depth:         4320/4320 HTTP 200, 0% fallback
Combined:             33345/33345 HTTP 200, 0% fallback
```

## 6. Verdict

```text
T20.38E: PASS
T20.38F: AUTHORIZED
```
