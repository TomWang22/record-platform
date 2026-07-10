# T20.40F — N=5 24-window real-participant depth decision package

**Status:** Decision **C selected — KEEP N=5 opt-in preview UI/API, PERCENT=0**  
**Generated:** 2026-07-04  
**Baseline SHA:** `de2b1e5`

---

## 1. Decision

```text
Selected: C — KEEP N=5 real-participant opt-in preview UI/API, PERCENT=0
Recommended next: D — readiness design only
Rejected: E — hybrid/vector production default
```

T20.40 satisfied the validator, 6480-case live matrix, rollback, OCH, telemetry, and Playwright gates. The correct decision is to keep opt-in preview UI/API enabled with keyword default and zero percentage rollout.

---

## 2. Evidence

| Evidence | Result |
|----------|--------|
| T20.40B validator | **PASS** |
| N=5 artifact | **PASS** |
| JWT sub match | **5/5 PASS** |
| T20.40C live | **6480/6480 HTTP 200** |
| Fallback | **0.0%** |
| Hybrid p95 | **164.39 ms** |
| Avg / worst quality | **4.0 / 4.0** |
| Gate counts | `preview_opt_in=5400`, `allowlist=1080` |
| Playwright C-suite | **7/7 PASS** |
| OCH | **PASS** |
| Telemetry WARNs | **0** |
| Rollback drill | **PASS** |
| Post-revoke | **all 5 keyword_default PASS** |
| Cumulative live | **44145/44145 HTTP 200**, 0% fallback |

---

## 3. Options

| Option | Decision | Rationale |
|--------|----------|-----------|
| A — rollback preview UI/API | **Not selected** | Live, rollback, OCH, telemetry, and Playwright gates passed. |
| B — keep current N=5 preview UI/API without more live eval | **Valid but not selected as final recommendation** | Conservative fallback remains available. |
| C — KEEP N=5 real-participant opt-in preview UI/API, PERCENT=0 | **SELECTED** | Best fit for passed evidence while preserving explicit opt-in and zero rollout. |
| D — recommend next readiness design only | **Recommended** | Next step should be design-only production-readiness decision, not a default switch. |
| E — approve hybrid/vector production default | **Rejected** | Production default remains keyword; no percentage rollout is approved. |

---

## 4. Final state

```text
Production default: keyword
Hybrid canary: KEEP
Allowlist: contract user only
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Preview UI/API: KEEP
```

---

## 5. Next recommendation

```text
Approved: start T20.41A N5 opt-in hybrid preview production-readiness decision design only
```

