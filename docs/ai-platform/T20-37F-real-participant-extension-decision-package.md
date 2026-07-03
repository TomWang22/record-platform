# T20.37F — Real-participant extension decision package

**Status:** Decision complete  
**Generated:** 2026-07-03  
**Baseline SHA:** `6858a38`  
**Image:** `python-ai-service:t20-p225b` / `webapp:t20-p227b`

---

## 1. Evidence summary

| Source | Key result |
|--------|------------|
| T20.36C | First real-participant soak **1440/1440**, 0% fallback |
| T20.37B | Artifact unchanged, validator **PASS** |
| T20.37C-LIVE | Extension **2880/2880**, 0% fallback, hybrid p95 **184 ms** |
| T20.37D | Rollback + CANARY=0 drill **PASS** |
| Cumulative live | **29025/29025** HTTP 200, 0% fallback |

## 2. Decision options

### Option A — STOP and revoke preview

**Not selected.** All gates PASS; rollback drill clean; no leakage.

### Option B — Broaden allowlist or enable PERCENT > 0

**Rejected.** Hard stops prohibit allowlist broadening and PERCENT > 0.

### Option C — KEEP real-participant opt-in preview UI/API, PERCENT=0 ✅ SELECTED

**Selected.** Evidence supports sustained real-participant opt-in preview at 16-window depth without production-default change.

### Option D — Next readiness step ✅ RECOMMENDED

**Recommended:** T20.38A broader real-participant opt-in hybrid preview **readiness design** (more participants or deeper matrix planning only — no rollout).

### Option E — Hybrid or vector production default

**Rejected.** Production default remains **keyword**.

---

## 3. Locked runtime (unchanged)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
Preview UI/API: KEEP
```

## 4. Verdict

```text
T20.37F: C selected (KEEP preview UI/API, PERCENT=0)
D recommended (T20.38A readiness design)
E rejected (production default)
T20.37G: AUTHORIZED
```
