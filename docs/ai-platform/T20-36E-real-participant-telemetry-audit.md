# T20.36E — Real-participant telemetry audit

**Status:** Telemetry audit **PASS**  
**Generated:** 2026-07-03  
**Soak artifact:** `bench_logs/ai-platform/t20-36c-real-participant-eval/20260703-035502/summary.json` (not committed)  
**Telemetry:** `bench_logs/ai-platform/quality-telemetry/20260703040331.json` (not committed)

---

## 1. Participant summary

| Metric | Value |
|--------|------:|
| Artifact path | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Complete participants | **3** (1× real_owner_approved, 2× internal_staff) |
| T20.36C live cases | **1440** |
| Cumulative live | **26145/26145** |

## 2. Soak telemetry

| Metric | Value |
|--------|------:|
| HTTP 200 | **1440/1440** |
| Fallback | **0%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality | **4.0** |
| Worst quality | **4.0** |
| Hybrid p50 / p95 | **37.47 / 159.61 ms** |
| Keyword p50 / p95 | **62.62 / 411.24 ms** |
| Canary errors | **0** |
| Telemetry WARNs | **0** |
| Leakage | **PASS** |
| Gate: preview_opt_in | **1080** |
| Gate: allowlist | **360** |

## 3. RP / UI

| Check | Result |
|-------|--------|
| RP | **PASS** (`__SCANNED__=590`) |
| Guest preview hidden | **PASS** (Playwright) |
| Message-body exposure | **0** |

## 4. Source diagnostic

`rp-ai-shadow-source-diagnostic.sh`: **FAIL** (31 issues, OBO/route) — report-only.

## 5. Verdict

```text
T20.36E: PASS
T20.36F: AUTHORIZED
```
