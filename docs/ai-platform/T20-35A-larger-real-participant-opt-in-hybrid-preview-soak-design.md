# T20.35A — Larger real-participant opt-in hybrid preview soak design

**Status:** Design complete — live eval **blocked** until participant artifact rows are complete  
**Generated:** 2026-07-03  
**Baseline SHA:** `9fca3b8`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objective

First **artifact-gated** real-participant soak track after T20.33/T20.34 blocked batches. T20.35 runs C-LIVE only when `T20-35-owner-approved-real-preview-participants.md` lists ≥3 **complete** owner-approved rows with verified JWT subs.

## 2. Participant classes

| Class | T20.35 role |
|-------|-------------|
| `real_owner_approved` | Primary soak cohort |
| `internal_staff` | Eligible with owner approval in artifact |
| `staging_cohort` | T20.29–T20.32 JWT accounts — **excluded** |
| `contract_allowlist` | Control only — not counted as real |

## 3. Artifact requirements

Path: `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

Each row: email, UUID/JWT sub, type, approval source, consent, preview-only scope, explicit NOs (message bodies, production defaults, PERCENT > 0, allowlist broadening).

**Minimum:** 3 complete `real_owner_approved` or owner-approved `internal_staff`.

## 4. Live matrix (if authorized)

```text
8 windows × N real participants × 5 runs/user/window × 9 cases/run
```

Contract allowlist user as control. Staging cumulative (24705/24705) not incremented by blocked T20.35.

## 5. Blocked path (current state)

Artifact **committed** but rows are **TBD** placeholders — 0 complete participants. C-LIVE blocked until owner fills email, UUID, approval source, and consent for ≥3 rows.

## 6. Enrollment lifecycle (C-LIVE only)

revoke → verify `keyword_default` → enroll → verify `preview_opt_in` + RAG probe → run → revoke.

## 7–10. Gates, rollback, rejections

Same as T20.34: UI/API consistency, `CANARY=0` drill after C-LIVE, telemetry/leakage/RP/Playwright gates, no production defaults, no staging relabeling.

## 11. Verdict

```text
T20.35A: DESIGN COMPLETE
T20.35B: AUTHORIZED (artifact audit + preflight)
T20.35C-LIVE: BLOCKED — artifact incomplete (TBD participant rows)
```
