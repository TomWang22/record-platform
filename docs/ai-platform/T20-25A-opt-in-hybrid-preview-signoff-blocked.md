# T20.25A — Opt-in hybrid preview sign-off BLOCKED

**Status:** **BLOCKED** — owner/product sign-off artifact absent  
**Generated:** 2026-07-01  
**Baseline SHA:** `1fa0c8b` (T20.24E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Mode:** Sign-off verification only — **no implementation**

---

## 1. Executive verdict

```text
T20.25A: BLOCKED
Sign-off artifact: ABSENT
Implementation: NOT STARTED
Code: UNCHANGED
Env: UNCHANGED
Image: UNCHANGED
T20.25B–H: NOT STARTED
```

Per hard stop: do **not** invent, self-sign, or imply owner/product approval. Full T20.25A–H batch requires a completed sign-off artifact in repo before runtime work begins.

---

## 2. Sign-off artifact search

| Path searched | Result |
|---------------|--------|
| `docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md` | **Not found** |
| `docs/ai-platform/*signoff*hybrid*preview*.md` | **Not found** |
| `docs/ai-platform/*sign-off*hybrid*preview*.md` | **Not found** |
| `docs/ai-platform/T20-25*.md` | **Not found** (this blocked doc excepted post-commit) |

### Required fields (all absent)

| Field | Status |
|-------|--------|
| Approver name | **Missing** |
| Approver role | **Missing** |
| Date (UTC) | **Missing** |
| Baseline SHA | **Missing** |
| Approval / signed artifact reference | **Missing** |
| Explicit approvals (opt-in preview, JWT only, PERCENT=0, etc.) | **Missing** |
| Explicit NOT approvals (hybrid default, vector default, PERCENT>0, etc.) | **Missing** |

Template for owner completion: `T20-24A-opt-in-hybrid-preview-implementation-design.md` §8.

---

## 3. Audit-only results (blocked path)

| Script | Result |
|--------|--------|
| `rp-rp-decontaminate-scan.sh` | **PASS** (`__SCANNED__=105`) |
| `ai-quality-telemetry-report.mjs` | **0 WARNs** (record 3.86, longform 3.67, final 4.0) |

No live inference. No deploy. No code change.

---

## 4. Locked operational state (unchanged)

| Item | Value |
|------|-------|
| Image | `python-ai-service:t20-p216b` |
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |
| Hybrid production default | **NOT APPROVED** |
| Opt-in preview implementation | **NOT APPROVED** |
| `AI_RAG_HYBRID_CANARY` | `1` |
| `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST` | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` |
| `AI_RAG_HYBRID_CANARY_PERCENT` | `0` |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` | `0` |
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |

---

## 5. Unlock procedure

1. Owner/product commits completed artifact, e.g. `docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md`, with all required fields and explicit approve / NOT approve checkboxes filled.
2. Re-run with approval phrase:

```text
Approved: start T20.25A-H opt-in hybrid preview implementation, live eval, decision, and closeout only after verified owner/product sign-off.
```

3. T20.25A verification doc must confirm artifact completeness before T20.25B code work.

---

## 6. Stop condition

```text
T20.25B–H: NOT STARTED
Next step: owner/product sign-off artifact commit
```
