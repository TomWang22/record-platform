# T20.33A — Real-participant opt-in hybrid preview readiness design

**Status:** Design complete — live eval **blocked** pending owner-approved participant artifacts  
**Generated:** 2026-07-02  
**Baseline SHA:** `155c36b`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Real-participant readiness objective

After T20.32 broader readiness (8640/8640 PASS on 12 JWT staging cohort), T20.33 validates **owner-approved real participants** before any larger real-participant soak (T20.34A). This batch does **not** re-run staging cohort soaks as “real participant” evidence.

## 2. Real vs staging participants

| Class | Examples | T20.33 live eval |
|-------|----------|------------------|
| `real_owner_approved` | Owner-signed production users with consent artifact | **Required** for C-LIVE |
| `internal_staff` | Staff accounts with documented approval | Counts only if artifact complete |
| `staging_cohort` | `t20-15g-cohort0@…`, bucket accounts | **Excluded** from real-participant eval |
| `contract_allowlist` | `e2e-contract@…` | Control only (`allowlist` gate) |

The existing **12 JWT test matrix** (T20.29–T20.32) is **staging_cohort** + **contract_allowlist**. It must not be labeled real-participant evidence.

## 3. Participant artifact requirements

Committed artifact (only when owner data exists):

`docs/ai-platform/T20-33-owner-approved-real-preview-participants.md`

Per participant: email, UUID, participant type, approval source, scope, consent, message-body exposure = NO, production default = NO, PERCENT > 0 = NO.

**Minimum for C-LIVE:** ≥3 `real_owner_approved` (or documented `internal_staff` with owner approval).

## 4. Live matrix (if authorized)

```text
8 windows × N owner-approved real participants × 5 runs/user/window × 9 cases/run
```

Plus contract allowlist user as control. Cumulative staging evidence (24705/24705) is **not** incremented by blocked T20.33.

## 5. Enrollment lifecycle

Per window (real participants only): revoke → verify `keyword_default` → enroll → verify `preview_opt_in` + RAG probe → run → revoke.

## 6. UI + API consistency

Same enroll/revoke/status/RAG gate checks as T20.27–T20.32; applied to artifact-listed participants only.

## 7. Telemetry and quality gates

HTTP 200 100%, fallback ≤1%, `final_tagged_plan` fallback 0, avg quality ≥3.5, worst ≥3.0, hybrid p95 ≤3000 ms, soak-path telemetry WARNs 0, leakage PASS, OCH PASS, Playwright PASS, PERCENT=0.

## 8. Rollback and `CANARY=0`

After live eval only: UI/API enroll-revoke, bulk revoke, `AI_RAG_HYBRID_CANARY=0` drill, KEEP restore. **Skipped** when C-LIVE is blocked.

## 9. Block criteria (current state)

**BLOCKED:** `T20-33-owner-approved-real-preview-participants.md` is **absent**. No owner-provided UUIDs in repo. Do not proceed to C-LIVE with staging JWT accounts.

## 10. Explicit rejections

- Hybrid/vector production default: **NOT APPROVED**
- Allowlist broadening: **NOT APPROVED**
- `AI_RAG_HYBRID_CANARY_PERCENT` > 0: **NOT APPROVED**
- Synthetic staging accounts as “real participants”: **REJECTED**

## 11. Verdict

```text
T20.33A: DESIGN COMPLETE
T20.33B: AUTHORIZED (artifact audit + preflight)
T20.33C-LIVE: BLOCKED pending owner-approved participant artifact
```
