# T20.37E — Real-participant extension telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-03  
**Soak artifact:** `bench_logs/ai-platform/t20-37c-real-participant-extension-eval/20260703-150857/summary.json` (not committed)  
**Telemetry:** `bench_logs/ai-platform/quality-telemetry/20260703152714.json` (not committed)

---

## 1. Participant summary

| Metric | Value |
|--------|------:|
| Artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` (unchanged) |
| Complete participants | **3** (1× real_owner_approved, 2× internal_staff) |
| T20.37C live cases | **2880** |
| Cumulative live | **29025/29025** |

## 2. Soak telemetry

| Metric | Value |
|--------|------:|
| HTTP 200 | **2880/2880** |
| Fallback | **0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p50 / p95 | **43.57 / 183.61 ms** |
| Keyword p50 / p95 | **68.98 / 469.64 ms** |
| Canary errors | **0** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Gate: preview_opt_in | **2160** |
| Gate: allowlist | **720** |
| keyword_default during matrix | **0** |

## 3. OCH / UI

| Check | Result |
|-------|--------|
| OCH | **PASS** (`__SCANNED__=590`) |
| Guest preview hidden | **PASS** (Playwright) |
| Message-body exposure | **0** |
| Playwright C-suite | **7/7 PASS** |

## 4. Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL** (20 issues, OBO/route) — report-only.

## 5. Cumulative live evidence

```text
Prior (D16→T20.36C): 26145/26145 HTTP 200, 0% fallback
T20.37C extension:      2880/2880 HTTP 200, 0% fallback
Combined:              29025/29025 HTTP 200, 0% fallback
```

## 6. Verdict

```text
T20.37E: PASS
T20.37F: AUTHORIZED
```
