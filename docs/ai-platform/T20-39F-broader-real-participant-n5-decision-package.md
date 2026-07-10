# T20.39F — Broader real-participant N=5 decision package

**Status:** Decision **C selected — KEEP opt-in preview UI/API, PERCENT=0**  
**Generated:** 2026-07-03  
**Baseline SHA:** `25e5865`

---

## 1. Decision

```text
Selected: C — KEEP broader real-participant opt-in preview UI/API, PERCENT=0
Recommended next: D — broader readiness decision design only
Rejected: E — hybrid/vector production default
```

T20.39 satisfied the N=5 participant gate, live matrix, rollback, OCH, telemetry, and Playwright gates. The correct decision is to keep opt-in preview UI/API enabled with keyword default and zero percentage rollout.

---

## 2. Evidence

| Evidence | Result |
|----------|--------|
| N=5 artifact validator | **PASS** |
| JWT sub match | **5/5 PASS** |
| T20.39C live | **4320/4320 HTTP 200** |
| Fallback | **0.0%** |
| Hybrid p95 | **131.99 ms** |
| Avg / worst quality | **4.0 / 4.0** |
| Gate counts | `preview_opt_in=3600`, `allowlist=720` |
| Playwright C-suite | **7/7 PASS** |
| OCH | **PASS** |
| Telemetry WARNs | **0** |
| Rollback drill | **PASS** |
| Post-revoke | **all 5 keyword_default PASS** |

---

## 3. Options

| Option | Decision | Rationale |
|--------|----------|-----------|
| A — rollback preview UI/API | **Not selected** | Live, rollback, OCH, telemetry, and Playwright gates passed. |
| B — keep API runtime, hide UI | **Not selected** | UI smoke and C-suite passed; no UI privacy or leakage issue found. |
| C — KEEP broader real-participant opt-in preview UI/API, PERCENT=0 | **SELECTED** | Best fit for passed evidence while preserving explicit opt-in and zero rollout. |
| D — recommend next readiness step | **Recommended** | Next work should be design-only readiness decision, not production default. |
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
Approved: start T20.40A broader real-participant opt-in hybrid preview readiness decision design only
```

