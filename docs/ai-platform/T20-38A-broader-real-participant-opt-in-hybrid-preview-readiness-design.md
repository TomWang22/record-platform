# T20.38A — Broader real-participant opt-in hybrid preview readiness design

**Status:** Design **COMPLETE** — no live eval, no artifact change  
**Generated:** 2026-07-03  
**Baseline SHA:** (post T20.37G closeout)  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Readiness objective

After T20.37A–H **CLOSED PASS** (extension soak **2880/2880**, cumulative **29025/29025**), T20.38 plans **broader real-participant readiness** — more owner-approved participants and/or deeper matrix options — **without** production-default promotion, allowlist broadening, or PERCENT > 0.

**Locked evidence:**

```text
T20.36C: 1440/1440 (8 windows, N=3)
T20.37C: 2880/2880 (16 windows, N=3)
Combined: 29025/29025 HTTP 200, 0% fallback
```

**Out of scope for T20.38A:** C-LIVE, env changes, staging cohort relabeling, hybrid/vector production default.

---

## 2. Current participant baseline (unchanged)

Artifact: `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` (3 rows, validator PASS @ T20.36B/T20.37B).

Automated gate: `scripts/audit-real-participant-artifact.sh` (JWT sub match + row validation + optional baseline SHA).

---

## 3. Broader readiness dimensions (design options)

| Dimension | T20.37 state | T20.38+ candidate (requires new approval) |
|-----------|--------------|------------------------------------------|
| Participant count (N) | 3 | 5–10 owner-approved rows in artifact |
| Window depth | 16 | 24–32 windows at same N |
| Matrix size | 2880 | scales as `windows × N × 5 × 9` preview + `windows × 720` allowlist |
| UI/API surface | KEEP | unchanged unless explicit UI ticket |
| PERCENT rollout | 0 | remains 0 |

**Recommended first expansion:** add **2–4** new owner-approved participants to artifact (not staging cohort), then T20.38B validator audit before any C-LIVE.

---

## 4. Participant intake (unchanged rules)

1. Owner completes row in `T20-35-owner-approved-real-preview-participants.md` (email, UUID/JWT sub, type, consent, signature).
2. `audit-real-participant-artifact.sh` with `T20_ARTIFACT_BASELINE_SHA` set to prior PASS commit.
3. JWT login + `sub` match after Redis cache invalidation if needed.
4. Reject: `@record-platform.local`, `t20-*`, contract personas, Playwright disposables.

---

## 5. Proposed gate matrix templates (not authorized to run)

### Option A — N=5, 16 windows

```text
16 × 5 × 5 × 9 = 3600 preview_opt_in
16 × 1 × 5 × 9 =  720 allowlist
Total = 4320
```

### Option B — N=3, 24 windows (depth extension)

```text
24 × 3 × 5 × 9 = 3240 preview_opt_in
24 × 1 × 5 × 9 = 1080 allowlist
Total = 4320
```

### Option C — N=5, 24 windows (full broader soak)

```text
24 × 5 × 5 × 9 = 5400 preview_opt_in
24 × 1 × 5 × 9 = 1080 allowlist
Total = 6480
```

All options require T20.38B validator PASS and explicit C-LIVE approval phrase.

---

## 6. Hard stops (unchanged)

- No hybrid/vector production default
- No `AI_RAG_HYBRID_CANARY_PERCENT > 0`
- No permanent allowlist broadening
- No message-body exposure
- No guest/anonymous hybrid
- No keyword fallback or anchor removal
- No staging cohort as real participants

---

## 7. Runtime (unchanged)

```text
webapp:t20-p227b
python-ai-service:t20-p225b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
Preview UI/API: KEEP
```

---

## 8. Verdict

```text
T20.38A: COMPLETE — design only
T20.38B: NOT STARTED — requires artifact change OR explicit matrix option + approval
Next approval phrase (validator): Approved: start T20.38B broader real-participant validator audit and proceed to T20.38C-LIVE only if artifact updated and preflight PASS
```
