# T20.15AD — 100% hybrid gate verification (percent-zero deploy)

**Status:** Complete — verification-only  
**Generated:** 2026-06-29  
**Baseline SHA:** `c996ff7` (T20.15AC)  
**Image:** `python-ai-service:t20-p215f` (unchanged — no runtime code changes)  
**Parent:** T20.15AC design

---

## Summary

T20.15F gate engine supports `PERCENT=100` via `bucket < percent` with percent clamped to 100 (buckets 0–99). **No `hybrid_canary.py` changes required.** AD added percent=100 bucket sampling test.

| Item | Result |
|------|--------|
| Code changed | **Tests only** |
| Image rebuilt | **No** — `t20-p215f` retained |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** (unchanged) |

---

## Gate behavior verified

| Rule | Verified |
|------|----------|
| `percent=100` → buckets 0–99 in cohort | Yes |
| Allowlist overrides percent | Yes |
| `percent=0` → keyword_default | Yes |
| Unauthenticated / invalid UUID → keyword_default | Yes |
| Prod percent blocked | Yes |
| No behavior change at PERCENT=0 | Yes |

---

## Test results

**33/33 PASS** (15B + 15F)

---

## Contract / readiness

All scripts **PASS** (rag contract, quality smoke, endpoints, provider, pgvector, RP).

---

## D-T control drill

Fake allowlist → keyword_default **PASS** · CANARY=0 → keyword **PASS** · KEEP restore → hybrid_canary/allowlist **PASS**

---

## Final env (post-AD)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## Stop condition

```text
T20.15AD: COMPLETE (verification-only)
T20.15AE: authorized to proceed
PERCENT=0
```
