# T20.25F — Opt-in hybrid preview decision package

**Status:** Decision recorded  
**Generated:** 2026-07-01  
**Sign-off:** `docs/ai-platform/T20-25-owner-product-signoff-opt-in-hybrid-preview.md`

---

## 1. Options

| Option | Description | Verdict |
|--------|-------------|---------|
| **A** | Rollback hybrid canary entirely | **Rejected** — scoped soak evidence supports KEEP allowlist |
| **B** | KEEP single-user allowlist only; disable all preview enrollments | Valid fallback; not selected (gates passed) |
| **C** | KEEP API-only opt-in preview enabled for signed-off users, PERCENT=0 | **SELECTED** |
| **D** | Recommend T20.26A opt-in preview UI design only | **Recommended next** |
| **E** | Approve production default switch | **REJECTED** (hard stop) |

## 2. Selected decision: **C**

Owner sign-off scope supports active API-only preview runtime with:

- JWT-only enroll / revoke / status
- Owner-scoped enrollment persistence
- `preview_opt_in` gate after allowlist, before percent logic
- Live eval **540/540** PASS; rollback drill PASS

Preview enrollments **revoked** post-drill (default safe state). Users may re-enroll via API when needed.

## 3. Locked operational verdict

| Item | Value |
|------|-------|
| Production default | **keyword** |
| Vector production default | **NOT APPROVED** |
| Hybrid production default | **NOT APPROVED** |
| `AI_RAG_HYBRID_CANARY_PERCENT` | **0** |
| Percentage rollout | **NOT APPROVED** |
| Allowlist canary | **KEEP** (`2ed75568-…`) |
| API-only preview | **ENABLED** (runtime); enrollments **off** until opt-in |
| UI preview toggle | **NOT APPROVED** |

## 4. Next track

```text
Approved: start T20.26A opt-in hybrid preview UI design only
```
