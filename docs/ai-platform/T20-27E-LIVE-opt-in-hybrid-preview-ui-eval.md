# T20.27E-LIVE — Opt-in hybrid preview UI eval

**Status:** Live eval **PASS**  
**Generated:** 2026-07-01  
**Webapp image:** `webapp:t20-p227b`  
**Python image:** `python-ai-service:t20-p225b`  
**Artifact:** `bench_logs/ai-platform/t20-25d-preview-eval/20260701-050505/summary.json`

---

## 1. Matrix

| Dimension | Value |
|-----------|-------|
| Windows | 1 |
| Users | 6 |
| Runs / user | 5 |
| Cases / run | 9 |
| **Total** | **270** |

Enrollment: 5 cohort users via API (UI enroll verified in Playwright `e2e/ai-rag-opt-in-hybrid-preview-ui.spec.ts`).

## 2. Results

| Gate | Result | Threshold |
|------|--------|-----------|
| HTTP 200 | **270/270** | 270/270 **PASS** |
| Fallback | **0%** | ≤1% **PASS** |
| `final_tagged_plan` fallback | **0** | 0 **PASS** |
| Avg quality | **4.0** | ≥3.5 **PASS** |
| Worst quality | **4.0** | ≥3.0 **PASS** |
| Hybrid p95 | **116.0 ms** | ≤3000 ms **PASS** |
| Canary errors | **0** | 0 **PASS** |
| Telemetry WARNs | **0** | 0 **PASS** |
| Leakage | **PASS** | **PASS** |
| OCH | **PASS** | **PASS** |
| PERCENT | **0** | **PASS** |
| Playwright (preview + seller + record + longform) | **PASS** | **PASS** |

### `gate_reason` counts

| `gate_reason` | Count |
|---------------|------:|
| `allowlist` | 45 |
| `preview_opt_in` | 225 |

## 3. Post-eval revoke

All cohort enrollments revoked; all cohort → `keyword` / `keyword_default`; contract → `hybrid_canary` / `allowlist`.

## 4. Supplementary shadow

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | **PASS** |
| `rp-ai-shadow-source-diagnostic.sh` | **FAIL (20 issues)** — known non-blocking class |

Anchored overlap **16/16** class; pure **8/16** report-only.

## 5. Cumulative live

| Batch | Cases |
|-------|------:|
| D16→D26C | 2835/2835 |
| T20.27E | 270/270 |
| **Total** | **3105/3105** |

## 6. Verdict

```text
T20.27E-LIVE: PASS
T20.27F: AUTHORIZED
```
