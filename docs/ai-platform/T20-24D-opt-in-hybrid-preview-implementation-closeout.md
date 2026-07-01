# T20.24D — Opt-in hybrid preview implementation design closeout

**Status:** T20.24 batch **CLOSED**  
**Generated:** 2026-07-01  
**Image:** `python-ai-service:t20-p216b`  
**Parent:** T20.24C decision (B selected; D and E rejected; implementation NOT APPROVED)

---

## 1. Final state

```text
T20.24A–D: COMPLETE
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Opt-in preview implementation: NOT APPROVED
Rollout: NOT APPROVED
T20.25A: NOT STARTED
```

---

## 2. Commit map (T20.24A → E)

| Ticket | SHA | Summary |
|--------|-----|---------|
| T20.24A | `8893087` | Opt-in hybrid preview implementation design |
| T20.24B | `66553d9` | Implementation sign-off gate audit |
| T20.24C | `4df4f3e` | Implementation decision package (B selected; implementation NOT APPROVED) |
| T20.24D | *(this commit)* | Implementation design closeout |
| T20.24E | *(pending)* | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

---

## 3. Evidence summary

| Evidence | Result |
|----------|--------|
| Combined live (D16→D21B) | **2025/2025** HTTP 200, **0%** fallback |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Anchored / pure overlap | **16/16 / 8/16** (report-only) |
| T20.24B audit | **PASS** (no new live inference) |

---

## 4. Selected decision

**B — KEEP single-user allowlist canary, percent=0**

**D rejected** — implementation not authorized (sign-off absent).  
**E rejected** — production default switch not authorized.

---

## 5. Sign-off summary

| Sign-off | Status |
|----------|--------|
| Owner/product | **ABSENT** |
| Engineering | **ABSENT** |
| Privacy | Evidence PASS; formal **ABSENT** |
| Ops/rollback | Runbook documented; formal **ABSENT** |
| Observability | Telemetry 0 WARNs; formal **ABSENT** |
| Support/comms | **ABSENT** |

Owner/product artifact template: `T20-24A-opt-in-hybrid-preview-implementation-design.md` §8.

---

## 6. Rollback runbook

1. Revoke all preview enrollment rows (if ever created)
2. `AI_RAG_HYBRID_CANARY_PERCENT=0`
3. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
4. Image pin: `python-ai-service:t20-p216b`
5. Restore single contract UUID allowlist

---

## 7. Hard stops

- Do **NOT** enable vector or hybrid production default
- Do **NOT** implement opt-in preview runtime without owner sign-off
- Do **NOT** change code, env, or image without T20.25A+ approval
- Do **NOT** set `PERCENT` > 0 without scoped approval
- Do **NOT** broaden allowlist without eval approval + restore plan
- Do **NOT** add UI preview toggles without separate approval
- Do **NOT** start T20.25A without approval phrase + sign-off artifacts
- Pure vector 8/16 remains report-only

---

## 8. Next optional track

```text
Approved: start T20.25A opt-in hybrid preview implementation only after sign-off
```

Prerequisite: commit owner/product sign-off artifact per T20.24A §8.

```text
T20.24 opt-in hybrid preview implementation design batch: CLOSED
Implementation: NOT APPROVED
Combined live evidence: 2025/2025 HTTP 200, 0% fallback
```
