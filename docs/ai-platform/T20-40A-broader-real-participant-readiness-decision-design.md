# T20.40A — Broader real-participant readiness decision design

**Status:** Design only — **COMPLETE**  
**Generated:** 2026-07-03  
**Baseline SHA:** `f4f5ae3`  
**Participant artifact SHA256:** `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa`

---

## 1. Executive verdict

```text
T20.40A: design only
Live eval: NOT RUN
Runtime/env/image change: NO
Production-default change: NO
Permanent allowlist broadening: NO
T20.40B: NOT STARTED
T20.40C-LIVE: NOT RUN
```

T20.40A evaluates readiness decision options after T20.39 closed PASS. It does not authorize or perform validator, live, rollback, telemetry, runtime, image, environment, production-default, or allowlist changes.

---

## 2. Evidence baseline

| Evidence | Result |
|----------|--------|
| T20.36C real-participant soak | **1440/1440** HTTP 200, 0% fallback |
| T20.37C real-participant extension | **2880/2880** HTTP 200, 0% fallback |
| T20.38C real-participant depth | **4320/4320** HTTP 200, 0% fallback |
| T20.39C N=5 real/internal soak | **4320/4320** HTTP 200, 0% fallback |
| Cumulative live | **37665/37665** HTTP 200, 0% fallback |
| N=5 artifact | **PASS** |
| Rollback | **PASS** |
| Telemetry WARNs | **0** |
| RP | **PASS** |
| Playwright C-suite | **7/7 PASS** |

T20.39C gate counts:

```text
preview_opt_in=3600
allowlist=720
hybrid p95=131.99 ms
```

---

## 3. Participant baseline

Counted N=5 real/internal participants:

| # | Email | Type |
|---|-------|------|
| 1 | tom@example.com | real_owner_approved |
| 2 | tw5126@example.com | internal_staff |
| 3 | seed@example.com | internal_staff |
| 4 | phase21-preview-internal-1@example.com | internal_staff |
| 5 | phase21-preview-internal-2@example.com | internal_staff |

Contract control:

```text
e2e-contract@record-platform.local / 2ed75568-7deb-4c29-91b0-6919f24a0c9f
```

The contract user is control-only and does not count as a real/internal participant.

---

## 4. Readiness decision options

| Option | Meaning                                               | T20.40A recommendation                          |
| ------ | ----------------------------------------------------- | ----------------------------------------------- |
| A      | Rollback preview UI/API                               | Not recommended                                 |
| B      | KEEP current N=5 preview UI/API with no new live eval | Valid conservative option                       |
| C      | Run N=5 depth extension, 24 windows                   | Recommended next live evidence if approved      |
| D      | Expand to N=8 with three more owner-approved rows     | Design candidate only; requires artifact update |
| E      | Hybrid/vector production default                      | REJECT                                          |

Recommendation: Option C is the next live-evidence path if separately approved. It deepens the current N=5 artifact without mixing in new participant-provisioning risk. Option D remains a design candidate only until three additional complete owner-approved/internal_staff rows are added and validated.

---

## 5. Proposed next live matrix options

### Option C — N=5, 24-window depth

```text
24 windows × 5 participants × 5 runs × 9 cases = 5400 preview_opt_in
24 windows × 1 contract control × 5 runs × 9 cases = 1080 allowlist
Total = 6480
```

Option C can use the current N=5 artifact if the T20.40B validator passes against the unchanged artifact SHA and 5/5 JWT sub match.

### Option D — N=8, 16-window expansion

```text
16 windows × 8 participants × 5 runs × 9 cases = 5760 preview_opt_in
16 windows × 1 contract control × 5 runs × 9 cases = 720 allowlist
Total = 6480
```

Option D requires three additional complete owner-approved/internal_staff rows before validator or live work. It must not count contract, staging, generated, t20, e2e, k6/load, benchmark, or auth-test users as real/internal participants.

---

## 6. T20.40B validator requirements

T20.40B must:

- Run `T20_MIN_PARTICIPANT_ROWS=5 scripts/audit-real-participant-artifact.sh`.
- Verify artifact SHA/freshness against the expected N=5 artifact.
- Verify JWT sub match for all counted participants.
- Reject staging/test/e2e/t20/contract users.
- Run all standard preflight scripts.
- Run preview UI smoke.
- Verify `AI_RAG_HYBRID_CANARY_PERCENT=0`.
- Verify `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`.
- Stop before live unless T20.40C is separately approved.

T20.40B is validator-only unless a separate approval explicitly authorizes T20.40C-LIVE.

---

## 7. T20.40C live gates, if later approved

If T20.40C is later approved, live gates are:

| Gate | Requirement |
|------|-------------|
| HTTP 200 | 100% |
| Fallback | target 0, hard max ≤1% |
| `final_tagged_plan` fallback | 0 |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | 0 |
| Telemetry WARNs | 0 |
| Leakage | PASS |
| RP | PASS |
| Playwright C-suite | PASS |
| Message-body exposure | 0 |
| Post-revoke keyword_default | PASS for all preview participants |
| PERCENT | 0 |

Only the clean final artifact and final passing run count.

---

## 8. Rollback requirements

Any later T20.40C live run must be followed by rollback proof:

- UI enroll/revoke.
- API enroll/revoke.
- Bulk revoke all participants.
- Verify participants return to `keyword` / `keyword_default`.
- Verify contract allowlist remains unchanged.
- Run `CANARY=0` drill.
- Restore KEEP env.

KEEP env:

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
Preview UI/API: KEEP
```

---

## 9. Explicit rejections

```text
Hybrid production default: NOT APPROVED
Vector production default: NOT APPROVED
PERCENT > 0: NOT APPROVED
Permanent allowlist broadening: NOT APPROVED
Message-body exposure: NOT APPROVED
Anonymous/guest hybrid access: NOT APPROVED
Staging cohort relabeling: NOT APPROVED
```

Keyword fallback and overlap anchors remain required.

---

## 10. Verdict

```text
T20.40A: COMPLETE — design only
T20.40B: NOT STARTED
T20.40C-LIVE: NOT RUN
Recommended next: Option C, N=5 24-window depth extension, only after separate approval
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
```

