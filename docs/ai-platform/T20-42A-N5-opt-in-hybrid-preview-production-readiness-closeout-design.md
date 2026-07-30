# T20.42A — N5 opt-in hybrid preview production-readiness closeout design

**Status:** Design only — **COMPLETE**  
**Generated:** 2026-07-04  
**Baseline HEAD:** `a02dadc`  
**Participant artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Executive verdict

```text
T20.42A: design only
Live eval: NOT RUN
Validator: NOT RUN
Runtime/env/image/default/allowlist/participant-artifact change: NO
User provisioning: NO
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
T20.42B: NOT STARTED
T20.42C-LIVE: NOT RUN
```

T20.42A converts the completed T20.41 production-readiness evidence into a closeout design for opt-in hybrid preview at PERCENT=0. It does not authorize production default changes, live evaluation, percentage rollout, permanent allowlist broadening, participant artifact changes, deployment changes, runtime/env/image edits, or user provisioning.

---

## 2. Evidence baseline

| Evidence | Result |
|----------|--------|
| T20.36C | **1440/1440** HTTP 200, 0% fallback |
| T20.37C | **2880/2880** HTTP 200, 0% fallback |
| T20.38C | **4320/4320** HTTP 200, 0% fallback |
| T20.39C | **4320/4320** HTTP 200, 0% fallback |
| T20.40C | **6480/6480** HTTP 200, 0% fallback |
| T20.41C | **8640/8640** HTTP 200, 0% fallback |
| Cumulative live | **52785/52785** HTTP 200, 0% fallback |

Latest T20.41C signals:

```text
Gate counts: preview_opt_in=7200, allowlist=1440
keyword_default during matrix: 0
Retrieval mode: hybrid_canary=8640
Hybrid p95: 140.4 ms
Avg/worst quality: 4.0 / 4.0
Rollback: PASS
Telemetry WARNs: 0
RP: PASS
Playwright C-suite: 7/7 PASS
Message-body exposure: 0
Post-revoke keyword_default: PASS for all 5
```

The evidence supports closing Phase 21 production-readiness work for opt-in preview UI/API at zero percent rollout. It does not authorize hybrid or vector production default.

---

## 3. Current participant baseline

Counted N=5 real/internal participants:

| # | Email | UUID | Type |
|---|-------|------|------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff |
| 4 | phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff |
| 5 | phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff |

Contract control:

```text
e2e-contract@record-platform.local
UUID: 2ed75568-7deb-4c29-91b0-6919f24a0c9f
Role: allowlist control only
```

Staging/test/e2e/t20/contract/load/generated/disposable users are not counted as real/internal participants.

---

## 4. Production-readiness closeout options

| Option | Meaning | T20.42A design verdict |
|--------|---------|------------------------|
| A | Rollback preview UI/API | **Not recommended** — T20.41 PASS supports KEEP |
| B | KEEP N5 opt-in preview UI/API at PERCENT=0 | **Selected** — conservative closeout path |
| C | Continue depth/live evidence | Optional future path only; **NOT AUTHORIZED** here |
| D | Expand participants beyond N=5 | Requires new owner-approved rows and separate validator; **NOT AUTHORIZED** here |
| E | Hybrid/vector production default | **REJECTED** |

Recommended closeout verdict:

```text
Option B selected — KEEP N5 opt-in preview UI/API at PERCENT=0.
Phase 21 production-readiness closeout-ready for opt-in preview.
Do not start production-default work.
Do not start live eval without separate approval.
```

---

## 5. Explicit locked state

```text
Production default: keyword
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
Permanent allowlist broadening: NOT APPROVED
PERCENT > 0: NOT APPROVED
ALLOW_PROD_PERCENT > 0: NOT APPROVED
Message-body exposure: NOT APPROVED
Anonymous/guest hybrid: NOT APPROVED
Staging cohort as real participants: NOT APPROVED
Keyword fallback: retained
Overlap anchors: retained
Preview UI/API: KEEP
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f (contract only)
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

---

## 6. Required evidence before any production-default RFC can even be drafted

Before any hybrid/vector production-default RFC can be drafted, require:

- Larger real participant set or longer soak beyond current 52785-case cumulative.
- Privacy/leakage sign-off.
- Rollback/runbook sign-off.
- Observability threshold sign-off.
- Support/comms sign-off.
- Explicit owner/product approval.
- Separate RFC approval phrase.

This is only a prerequisite list. It is **not** an approval or recommendation to switch defaults.

---

## 7. Future gates, if any later batch is approved

If a future batch is separately approved, re-run these gates before live:

```text
1. Re-run artifact validator (T20_MIN_PARTICIPANT_ROWS=N scripts/audit-real-participant-artifact.sh)
2. Verify N=5 or updated N rows with JWT sub match
3. Verify artifact SHA unchanged unless owner-approved
4. Verify KEEP env:
   - AI_RAG_HYBRID_CANARY=1
   - AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
   - AI_RAG_HYBRID_CANARY_PERCENT=0
   - AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
5. Run standard preflight scripts
6. Run preview UI smoke
7. STOP before live unless separately approved
```

T20.42A does not authorize T20.42C-LIVE or any live inference matrix.

---

## 8. Recommended next state

```text
Phase 21 can be considered production-readiness-closeout-ready for opt-in preview at PERCENT=0.
Do not start production-default work.
Do not start live eval without separate approval.
Recommended next step: T20.42B validator-only closeout audit, not C-LIVE by default.
```

T20.42B should confirm artifact freshness, KEEP env, preflight, and preview UI smoke only. It should not change runtime, env, images, defaults, allowlist, participant artifact, or deployment.

---

## 9. Explicit rejections

```text
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
PERCENT > 0: NOT APPROVED
ALLOW_PROD_PERCENT > 0: NOT APPROVED
Permanent allowlist broadening: NOT APPROVED
Message-body exposure: NOT APPROVED
Anonymous/guest hybrid: NOT APPROVED
Staging cohort as real participants: NOT APPROVED
Keyword fallback removal: NOT APPROVED
Overlap anchor removal: NOT APPROVED
Live eval in T20.42A: NOT RUN
Validator in T20.42A: NOT RUN
```

---

## 10. Next approval phrase

```text
Approved: start T20.42B N5 opt-in hybrid preview production-readiness closeout validator only
```
