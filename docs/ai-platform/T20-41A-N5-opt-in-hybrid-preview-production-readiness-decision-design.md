# T20.41A — N5 opt-in hybrid preview production-readiness decision design

**Status:** Design only — **COMPLETE**  
**Generated:** 2026-07-04  
**Baseline HEAD:** `8e447a2`  
**Participant artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Executive verdict

```text
T20.41A: design only
Live eval: NOT RUN
Runtime/env/image/default/allowlist change: NO
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
T20.41B: NOT STARTED
T20.41C-LIVE: NOT RUN
```

T20.41A converts the completed T20.40 evidence into a production-readiness decision framework. It does not authorize production default changes, live evaluation, percentage rollout, permanent allowlist broadening, participant artifact changes, deployment changes, or runtime/env/image edits.

---

## 2. Evidence baseline

| Evidence | Result |
|----------|--------|
| T20.36C | **1440/1440** HTTP 200, 0% fallback |
| T20.37C | **2880/2880** HTTP 200, 0% fallback |
| T20.38C | **4320/4320** HTTP 200, 0% fallback |
| T20.39C | **4320/4320** HTTP 200, 0% fallback |
| T20.40C | **6480/6480** HTTP 200, 0% fallback |
| Cumulative live | **44145/44145** HTTP 200, 0% fallback |

Latest T20.40C signals:

```text
Gate counts: preview_opt_in=5400, allowlist=1080
Hybrid p95: 164.39 ms
Avg/worst quality: 4.0 / 4.0
Rollback: PASS
Telemetry WARNs: 0
RP: PASS
Playwright C-suite: 7/7 PASS
```

The evidence supports keeping opt-in preview UI/API at zero percent rollout. It does not yet authorize hybrid or vector production default.

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

## 4. Production-readiness decision options

| Option | Meaning | T20.41A design verdict |
|--------|---------|------------------------|
| A | Rollback preview UI/API | Not recommended after T20.40 PASS |
| B | Keep current N=5 opt-in preview UI/API, no further live | Valid conservative option |
| C | Continue N=5 opt-in preview with another depth/soak evidence batch | Valid future evidence path, not authorized here |
| D | Expand participants beyond N=5 only after new owner-approved rows | Design candidate only; requires artifact update |
| E | Production default switch | **REJECT** |

Recommended design verdict:

```text
KEEP opt-in preview UI/API.
Keep PERCENT=0 and ALLOW_PROD_PERCENT=0.
Keep production default keyword.
Do not recommend hybrid/vector production default yet.
```

---

## 5. Required evidence before any production-default discussion

Before any hybrid/vector production-default discussion, require:

- More real participants or longer soak.
- Formal owner/product sign-off for a default change.
- Privacy/leakage sign-off.
- Rollback/runbook sign-off.
- Support/comms sign-off.
- Observability threshold agreement.
- No unresolved source diagnostic class promoted as blocking default evidence.

This does not mean production default is planned. It defines evidence required before the topic can be reopened safely.

---

## 6. T20.41B validator design

T20.41B must be validator-only unless separately approved.

Required validator gates:

- Re-check artifact SHA and N=5 participant rows.
- Re-check JWT sub match for all counted participants.
- Re-check KEEP env:
  - `AI_RAG_HYBRID_CANARY=1`
  - `AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f`
  - `AI_RAG_HYBRID_CANARY_PERCENT=0`
  - `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`
- Run standard preflight scripts.
- Run preview UI smoke.
- Stop before live.

T20.41B must not change runtime/env/images/defaults/allowlist and must not run T20.41C-LIVE without a separate approval phrase.

---

## 7. Future live options, not authorized in T20.41A

All options below are **NOT AUTHORIZED** in T20.41A.

### Option C1 — N=5, 32-window depth

```text
32 windows × 5 participants × 5 runs × 9 cases = 7200 preview_opt_in
32 windows × 1 contract control × 5 runs × 9 cases = 1440 allowlist
Total = 8640
```

Purpose: longer N=5 depth soak without participant expansion.

### Option D1 — N=8 after three new approved participants

```text
16 windows × 8 participants × 5 runs × 9 cases = 5760 preview_opt_in
16 windows × 1 contract control × 5 runs × 9 cases = 720 allowlist
Total = 6480
```

Purpose: expansion breadth after three additional complete owner-approved/internal_staff rows are added to the artifact and validated.

### Option D2 — owner-approved external/beta participant intake

Formula after owner-approved external/beta intake:

```text
W windows × (5 + E) participants × 5 runs × 9 cases = W × (5 + E) × 45 preview_opt_in
W windows × 1 contract control × 5 runs × 9 cases = W × 45 allowlist
Total = W × (6 + E) × 45
```

Where `E` is the number of additional owner-approved external/beta participants. This option requires a new participant artifact update, intake validation, consent/signature proof, JWT sub match, and a separate validator approval.

---

## 8. Rollback requirements for any future live

Any future live run must include rollback proof:

- UI enroll/revoke.
- API enroll/revoke.
- Bulk revoke all participants.
- `CANARY=0` drill.
- KEEP restore.
- Post-restore probes.

Required post-restore state:

```text
Contract control: hybrid_canary / allowlist
All preview participants: keyword / keyword_default
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
```

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
```

---

## 10. Next approval phrase

```text
Approved: start T20.41B N5 production-readiness validator audit only
```

