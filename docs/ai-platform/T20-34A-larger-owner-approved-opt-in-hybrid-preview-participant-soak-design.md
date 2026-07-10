# T20.34A — Larger owner-approved opt-in hybrid preview participant soak design

**Status:** Design complete — live eval **blocked** pending owner-approved participant artifact  
**Generated:** 2026-07-02  
**Baseline SHA:** `187f108`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objective

Move from T20.33 **CLOSED/BLOCKED** (0 real participants, no artifact) to an **artifact-gated** larger owner-approved participant soak. T20.34 does **not** add staging/JWT cohort evidence; it waits for committed owner data or documents block.

## 2. Participant classes

| Class | Role in T20.34 |
|-------|----------------|
| `real_owner_approved` | Primary soak cohort — **required** (≥3) |
| `internal_staff` | Eligible only with owner approval in artifact |
| `staging_cohort` | T20.29–T20.32 JWT test accounts — **excluded** from real-participant eval |
| `contract_allowlist` | `e2e-contract@…` — control only (`allowlist` gate), not counted as real |

## 3. Artifact requirements

Committed artifact (owner data only):

`docs/ai-platform/T20-34-owner-approved-real-preview-participants.md`

Per participant: email, UUID/JWT sub, participant type, approval source, opt-in preview scope, consent, explicit NO to message-body exposure, hybrid/vector production default, PERCENT > 0, and allowlist broadening.

**Minimum:** 3 `real_owner_approved` or owner-approved `internal_staff`.

## 4. Live matrix (if artifact authorized)

```text
8 windows × N real participants × 5 runs/user/window × 9 cases/run
```

Plus contract allowlist user as control. Cumulative staging live (24705/24705) is **not** incremented by blocked T20.34.

## 5. Blocked path (current state)

**BLOCKED:** `T20-34-owner-approved-real-preview-participants.md` **absent**. T20.33 artifact path also absent. Do not run staging 12-JWT matrix as substitute.

## 6. Enrollment lifecycle (C-LIVE only)

Per window per real participant: revoke → verify `keyword_default` → enroll → verify `preview_opt_in` + RAG probe → run matrix → revoke.

## 7. UI + API consistency

Enroll/revoke/status/RAG gate checks on artifact-listed participants only; same controls as T20.27–T20.33.

## 8. Rollback and `CANARY=0`

After C-LIVE only: UI/API churn, bulk revoke, `AI_RAG_HYBRID_CANARY=0` drill, KEEP restore. **Skipped** when C-BLOCKED.

## 9. Gates

HTTP 200 100%, fallback ≤1%, `final_tagged_plan` fallback 0, avg quality ≥3.5, worst ≥3.0, hybrid p95 ≤3000 ms, soak-path telemetry WARNs 0, leakage PASS, OCH PASS, Playwright PASS, PERCENT=0, guest hidden, no message bodies.

## 10. Explicit rejections

- Hybrid/vector production default: **NOT APPROVED**
- Allowlist broadening: **NOT APPROVED**
- `AI_RAG_HYBRID_CANARY_PERCENT` > 0: **NOT APPROVED**
- Staging cohort as real-participant evidence: **REJECTED**

## 11. Verdict

```text
T20.34A: DESIGN COMPLETE
T20.34B: AUTHORIZED (artifact audit + preflight)
T20.34C-LIVE: BLOCKED pending T20-34-owner-approved-real-preview-participants.md
```
