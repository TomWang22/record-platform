# T20.37A — Real-participant opt-in hybrid preview extension design

**Status:** Design **COMPLETE** — no live eval  
**Generated:** 2026-07-03  
**Baseline SHA:** `291658f`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Extension objective

After T20.36A–H **CLOSED PASS** (first real-participant soak: **1440/1440**), T20.37 extends evidence depth with a **16-window** matrix on the **same 3 validator-passing artifact participants** — without broadening allowlist, changing PERCENT, or substituting staging cohort users.

**Baseline evidence (locked):**

```text
T20.36C-LIVE: PASS 1440/1440 HTTP 200, 0% fallback, hybrid p95 160 ms
Cumulative (D16→T20.36C): 26145/26145 HTTP 200, 0% fallback
```

**Out of scope for T20.37A:** C-LIVE, runtime/env changes, new participants without artifact update, production-default promotion.

---

## 2. Participants (unchanged from T20.36)

Artifact: `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`  
Validator: `docs/ai-platform/T20-36B-real-participant-artifact-validator-audit.md` (**PASS 3/3**)

| # | Email | UUID | Type | Matrix role |
|---|-------|------|------|-------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | preview_opt_in |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | preview_opt_in |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | preview_opt_in |
| — | e2e-contract@record-platform.local | `2ed75568-7deb-4c29-91b0-6919f24a0c9f` | contract control | allowlist |

T20.29–T20.32 staging 12-JWT cohort: **excluded**. Contract user counts as **control only**, not as a real participant.

T20.37B must re-verify artifact unchanged (or re-validate if rows change) before C-LIVE.

---

## 3. Proposed 2880-case live matrix (T20.37C-LIVE only)

```text
16 windows × 3 real participants × 5 runs/user/window × 9 cases/run = 2160 preview_opt_in
16 windows × 1 contract control × 5 runs × 9 cases/run           =  720 allowlist
Total                                                              = 2880
```

| Metric | T20.36C (baseline) | T20.37C (proposed) |
|--------|-------------------:|-------------------:|
| Windows | 8 | **16** |
| Real participants (N) | 3 | 3 |
| preview_opt_in cases | 1080 | **2160** |
| allowlist cases | 360 | **720** |
| **Total** | **1440** | **2880** |

Runner pattern: extend `scripts/t20-36c-real-participant-soak-eval.py` → `t20-37c-real-participant-extension-soak-eval.py` with `T20_25D_WINDOWS=16`, `T20_EVAL_USER_SET=real-participant-36`.

---

## 4. Per-window lifecycle

Each of 16 windows:

1. **Revoke** all preview enrollments (3 real participants).
2. **Verify** all 3 participants → `keyword` / `keyword_default` (status + RAG probe).
3. **Enroll** all 3 via preview API (owner_opt_in).
4. **Verify** preview status → `preview_opt_in`; RAG probe → hybrid anchored / `preview_opt_in`.
5. **Verify** contract control → `hybrid_canary` / `allowlist` (not preview-enrolled).
6. **Verify** `AI_RAG_HYBRID_CANARY_PERCENT=0` and `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0`.
7. **Run** 9-case transcript matrix: 3 participants + 1 contract × 5 runs.
8. **Retry/backoff** on HTTP 429 (existing eval runner pattern).
9. After full soak: **revoke** all real participant enrollments.

Post-soak: all non-allowlist users → `keyword_default`.

---

## 5. Hard gates (T20.37C-LIVE)

| Gate | Threshold |
|------|-----------|
| HTTP 200 | **2880/2880** (100%) |
| Fallback rate | ≤1% |
| `final_tagged_plan` fallback | **0** |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | **0** |
| Soak-path telemetry WARNs | **0** |
| Leakage | **PASS** |
| RP | **PASS** |
| Playwright C-suite | **PASS** |
| Guest preview hidden | **PASS** |
| Message-body exposure | **0** |
| PERCENT=0 | **PASS** |
| Post-revoke `keyword_default` | **PASS** (all 3 participants) |

Only the **clean final artifact** counts. Failed early runs documented separately and excluded from closeout totals.

---

## 6. T20.37D rollback drill requirements

After C-LIVE PASS only:

1. UI enroll/revoke at least one real participant (tom@example.com).
2. API enroll/revoke a different real participant (tw5126@example.com).
3. Bulk revoke all 3 real participants.
4. Verify all 3 → `keyword_default`; contract → `allowlist`.
5. **`AI_RAG_HYBRID_CANARY=0`** drill → contract + all participants keyword.
6. **KEEP env restore** (same as T20.36D).
7. Post-restore probes: contract `allowlist`, participants `keyword_default`.

If C-LIVE blocked or fails: **T20.37D SKIPPED**.

---

## 7. T20.37E telemetry audit requirements

| Item | Requirement |
|------|-------------|
| Soak summary path | `bench_logs/ai-platform/t20-37c-…/summary.json` (not committed) |
| Participant count | 3 artifact + 1 contract control |
| T20.37C cases | 2880 or blocked status |
| Gate reason counts | preview_opt_in + allowlist |
| Quality / latency | avg, worst, hybrid p50/p95, keyword p50/p95 |
| Telemetry WARNs | 0 for soak path |
| RP | PASS |
| Leakage / message bodies | PASS / 0 |
| Source diagnostic | report-only if OBO/route class |
| Cumulative live | prior 26145 + T20.37C increment |

---

## 8. T20.37F decision options

| Option | Meaning | Expected if C-LIVE PASS |
|--------|---------|-------------------------|
| A | Rollback preview UI and API | Not selected |
| B | KEEP API runtime, hide UI | Not selected |
| C | KEEP real-participant opt-in preview UI/API, PERCENT=0 | **SELECTED** |
| D | Recommend next broader real-participant readiness | **RECOMMENDED** |
| E | Approve hybrid/vector production default | **REJECTED** |

Expected if C-LIVE blocked:

```text
C selected (KEEP UI/API unchanged)
Real-participant extension BLOCKED
D recommends artifact/participant acquisition or re-run after fix
E rejected
```

Production default remains **keyword**. Vector/hybrid production default **NOT APPROVED**.

---

## 9. Explicit rejections (unchanged)

- Hybrid or vector production default
- `AI_RAG_HYBRID_CANARY_PERCENT > 0`
- Permanent allowlist broadening
- Message-body exposure
- Anonymous/guest hybrid access
- Removal of keyword fallback or overlap anchors
- Staging cohort as real-participant substitute
- Relabeling test users as real participants

---

## 10. Runtime (unchanged)

```text
webapp:t20-p227b
python-ai-service:t20-p225b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
API-only opt-in preview: KEEP
Opt-in preview UI: KEEP
```

---

## 11. Verdict

```text
T20.37A: COMPLETE — design only
T20.37B: NOT STARTED — requires separate approval
T20.37C-LIVE: NOT RUN
Next approval phrase (B/C): Approved: start T20.37B real-participant extension validator audit and proceed to T20.37C-LIVE only if artifact unchanged and preflight PASS
```
