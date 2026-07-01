# T20.26D — Opt-in hybrid preview UI decision package

**Status:** Decision recorded  
**Generated:** 2026-07-01  
**Parent:** T20.26C-LIVE PASS (270/270)

---

## 1. Options

| Option | Description | Verdict |
|--------|-------------|---------|
| **A** | Rollback preview runtime entirely | **Rejected** |
| **B** | KEEP API-only preview runtime; no UI implementation | **SELECTED** |
| **C** | Recommend T20.27A UI implementation if owner approves | **Recommended next** |
| **D** | Approve UI implementation now | **REJECTED** — requires T20.27 approval phrase |
| **E** | Approve hybrid/vector production default | **REJECTED** |

## 2. Rationale

T20.26A UI design is complete. T20.26B runtime audit and T20.26C live smoke confirm the API state a future UI would control (enroll → `preview_opt_in`, revoke → `keyword_default`, allowlist unchanged). No UI code is authorized in T20.26.

## 3. Locked verdict

```text
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
API-only opt-in preview runtime: KEEP
UI preview implementation: NOT APPROVED
AI_RAG_HYBRID_CANARY_PERCENT=0
Preview enrollments revoked after eval
T20.27A: NOT STARTED
```

## 4. Next approval phrase

```text
Approved: start T20.27A opt-in hybrid preview UI implementation only
```
