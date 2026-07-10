# T20.16E — Hybrid production-readiness decision package

**Status:** Decision complete (docs only)  
**Generated:** 2026-06-30  
**Baseline SHA:** `7872a5a` + D-LIVE eval  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.16D-LIVE — **PASS**

---

## 1. Executive verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid allowlist canary: KEEP
AI_RAG_HYBRID_CANARY_PERCENT=0
T20.16 production-readiness: evidence improved, but default rollout NOT APPROVED
```

---

## 2. Evidence summary (T20.16A → D-LIVE)

| Ticket | Contribution |
|--------|--------------|
| T20.16A | Production-readiness design, blocker map, gate proposal |
| T20.16B | `final_tagged_plan` remediation — fallback 11.11% → **0%** |
| T20.16C | Pure 8/16 report-only; anchored 16/16; no pure-vector impl |
| T20.16D | Live-inference eval plan |
| **D-LIVE** | **45/45 HTTP 200**, **0% fallback**, avg score **4.0**, hybrid p95 **439 ms**, Playwright **PASS** |

---

## 3. Options

### A. ROLLBACK hybrid canary entirely — **Not selected**

D-LIVE proves stable hybrid anchored path with zero fallback on 45 live cases.

### B. KEEP allowlist canary only, percent=0 ✅ **SELECTED**

Operational state unchanged; evidence supports continued allowlist-only hybrid for diagnostics.

### C. KEEP allowlist + prepare future scoped production-readiness soak design ✅ **RECOMMENDED**

If owner approves **T20.17A** (design-only soak), define longer live-inference windows and broader user cohorts — **not** default rollout.

### D. Approve production default switch — **Rejected**

Vector production default **NOT APPROVED**. Pure overlap **8/16**. Hybrid depends on keyword anchors. No owner/product decision to change default.

---

## 4. Rationale

### Why pure vector remains report-only

- Stable **8/16** across G3R, H1, T20.15, T20.16C/D-LIVE shadow
- Eight cases require **keyword overlap anchors** — not pure vector
- T20.16C research: moving +2 without anchors is high-risk / low-confidence

### Why hybrid anchored canary is safe to KEEP

- D-LIVE: **45/45** live API cases, **0% fallback**, leakage **PASS**
- `final_tagged_plan` fixed (T20.16B) — **5/5 hybrid_canary**, score **4.0**
- Anchored shadow **16/16**; rollback drills **PASS**
- Keyword fallback and anchors intact

### Why production default is still keyword

- Lane C is Phase 21 release-tagged path
- No soak with heterogeneous production users beyond contract allowlist
- Pure vector and default-switch blockers remain

---

## 5. Remaining blockers (before any default decision)

| Blocker | Status |
|---------|--------|
| Pure overlap 8/16 | Open — report-only |
| Hybrid depends on keyword anchors | Structural |
| Longer soak / broader real users | Not done |
| Owner/product default decision | Not made |
| Source diagnostic (20 issues) | Informational; non-blocking |

---

## 6. Final env

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_REQUIRE_KEYWORD_FALLBACK=1
AI_RAG_HYBRID_LOG_PURE_VECTOR=1
AI_RAG_HYBRID_ANCHOR_MAX=1
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
image: python-ai-service:t20-p216b
```

---

## 7. Next step

**T20.16F** closeout. Optional future: **T20.17A scoped hybrid soak design** (owner approval required).

```text
Approved: start T20.17A scoped hybrid soak design only
```

Do **not** start T20.17A without this phrase.
