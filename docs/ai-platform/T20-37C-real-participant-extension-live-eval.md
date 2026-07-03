# T20.37C — Real-participant extension live eval

**Status:** C-LIVE **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `6858a38`  
**Artifact:** `bench_logs/ai-platform/t20-37c-real-participant-extension-eval/20260703-150857/summary.json` (not committed)  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Participants (artifact-gated)

| Email | UUID | Type | Role in matrix |
|-------|------|------|----------------|
| tom@example.com | `0dc268d0-…` | real_owner_approved | preview_opt_in |
| tw5126@example.com | `950a40b1-…` | internal_staff | preview_opt_in |
| seed@example.com | `2901355e-…` | internal_staff | preview_opt_in |
| e2e-contract@record-platform.local | `2ed75568-…` | contract control | allowlist |

Staging 12-JWT cohort: **not used**.

## 2. Matrix

```text
16 windows × 3 preview participants × 5 runs × 9 cases = 2160 preview_opt_in
16 windows × 1 contract control × 5 runs × 9 cases = 720 allowlist
Total = 2880
```

## 3. Live results

| Gate | Threshold | Result |
|------|-----------|--------|
| HTTP 200 | 2880/2880 | **PASS** (2880/2880) |
| Fallback rate | ≤1% | **PASS** (0%) |
| `final_tagged_plan` fallback | 0 | **PASS** (0) |
| Avg quality | ≥3.5 | **PASS** (4.0) |
| Worst quality | ≥3.0 | **PASS** (4.0) |
| Hybrid p95 | ≤3000 ms | **PASS** (183.61 ms) |
| Canary errors | 0 | **PASS** (0) |
| Leakage | PASS | **PASS** |
| Gate counts | preview_opt_in + allowlist | **2160 + 720** |
| keyword_default during matrix | 0 | **PASS** |
| Post-revoke `keyword_default` | all 3 participants | **PASS** |
| PERCENT=0 | enforced | **PASS** |

## 4. Playwright C-suite

| Spec | Result |
|------|--------|
| `ai-rag-opt-in-hybrid-preview-ui.spec.ts` | **4/4 PASS** |
| `seller-intelligence-ui.spec.ts` | **1/1 PASS** |
| `ai-rag-record-intelligence.spec.ts` | **1/1 PASS** |
| `ai-rag-longform-record-session.spec.ts` | **1/1 PASS** |

## 5. OCH / telemetry

| Check | Result |
|-------|--------|
| OCH | **PASS** (`__SCANNED__=590`) |
| Soak-path telemetry WARNs | **0** |

## 6. Shadow diagnostics

Source diagnostic: **FAIL** (20 issues, OBO/route class) — **report-only**; live gates and leakage PASS.

## 7. Cumulative live

```text
Prior (D16→T20.36C): 26145/26145
T20.37C extension:      2880/2880
Combined:              29025/29025 HTTP 200, 0% fallback
```

## 8. Verdict

```text
T20.37C-LIVE: PASS
T20.37D: AUTHORIZED
```
