# T20.38F — Broader real-participant depth decision package

**Status:** Decision complete  
**Generated:** 2026-07-03  
**Baseline SHA:** `cfbc796`  
**Image:** `python-ai-service:t20-p225b` / `webapp:t20-p227b`

---

## 1. Evidence summary

| Source | Key result |
|--------|------------|
| T20.37C | Real-participant extension **2880/2880**, 0% fallback |
| T20.38B | Artifact unchanged, validator **PASS** for Option B |
| T20.38C-LIVE | Depth extension **4320/4320**, 0% fallback, hybrid p95 **151 ms** |
| T20.38D | UI/API rollback + CANARY=0 drill **PASS** |
| Cumulative live | **33345/33345** HTTP 200, 0% fallback |

## 2. Decision options

### Option A — STOP and revoke preview

**Not selected.** All hard gates PASS; rollback drill clean; no leakage.

### Option B — Keep N=3 only and stop depth work

**Not selected.** Evidence supports proceeding to a broader readiness design, but not production default.

### Option C — KEEP real-participant opt-in preview UI/API, PERCENT=0 ✅ SELECTED

**Selected.** The N=3, 24-window depth extension passed without fallback, leakage, or telemetry WARNs.

### Option D — Next readiness step ✅ RECOMMENDED

**Recommended:** T20.39A broader real-participant opt-in hybrid preview **expansion design**. N=5 expansion requires two additional approved participant rows before validator/live work.

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
T20.38F: C selected (KEEP preview UI/API, PERCENT=0)
D recommended (T20.39A expansion design)
E rejected (production default)
T20.38G: AUTHORIZED
```
