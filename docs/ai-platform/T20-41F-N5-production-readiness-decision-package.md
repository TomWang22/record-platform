# T20.41F — N=5 production-readiness decision package

**Status:** Decision package **COMPLETE**  
**Generated:** 2026-07-04  
**Artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Selected decision

```text
C selected — KEEP N5 opt-in preview UI/API, PERCENT=0
D recommended — next readiness/design step only (T20.42A)
E rejected — hybrid/vector production default
```

---

## 2. Evidence summary

| Source | Result |
|--------|--------|
| T20.41B validator | PASS — N=5 artifact, JWT sub match, preflight, UI smoke |
| T20.41C-LIVE | PASS — 8640/8640 HTTP 200, 0% fallback, hybrid p95 140.4 ms |
| T20.41D rollback | PASS — UI/API enroll-revoke, bulk revoke, CANARY=0, KEEP restore |
| T20.41E telemetry | PASS — OCH, WARNs 0, Playwright 7/7 |
| Cumulative live | 52785/52785 HTTP 200, 0% fallback |

Gate counts from T20.41C:

```text
preview_opt_in = 7200
allowlist = 1440
keyword_default during matrix = 0
hybrid_canary = 8640
```

---

## 3. Explicit state

```text
Production default: keyword
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
PERCENT > 0: NOT APPROVED
Permanent allowlist broadening: NOT APPROVED
Preview UI/API: KEEP
```

---

## 4. Rejected options

**E — hybrid/vector production default:** Rejected. T20.41C production-readiness depth evidence supports continued opt-in preview at PERCENT=0 only. No production-default switch is authorized.

**Permanent allowlist broadening:** Rejected. Contract user `2ed75568-7deb-4c29-91b0-6919f24a0c9f` remains the sole permanent allowlist entry.

**PERCENT rollout:** Rejected. `AI_RAG_HYBRID_CANARY_PERCENT=0` and `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0` throughout.

---

## 5. Recommended next step

```text
D recommended — T20.42A N5 opt-in hybrid preview production-readiness closeout design only
```

Next approval phrase:

```text
Approved: start T20.42A N5 opt-in hybrid preview production-readiness closeout design only
```
