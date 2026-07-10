# T20.39A - Broader real-participant expansion design

**Status:** Design **COMPLETE** - no live eval  
**Generated:** 2026-07-03  
**Baseline SHA:** `2cd90b5`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objective

T20.39 moves from the current **N=3** real/internal participant evidence base to a broader owner-approved participant expansion. The first expansion target is **N=5**, requiring **two additional complete owner-approved participant rows** before validator/live work can proceed.

This is a design-only step. It does not authorize live eval, runtime/env changes, production-default changes, allowlist broadening, or percentage rollout.

---

## 2. Current baseline

| Evidence | Result |
|----------|--------|
| T20.36C | **1440/1440** HTTP 200, 0% fallback |
| T20.37C | **2880/2880** HTTP 200, 0% fallback |
| T20.38C | **4320/4320** HTTP 200, 0% fallback |
| Combined live | **33345/33345** HTTP 200, 0% fallback |
| Current validated real/internal participant count | **3** |
| Participant artifact | `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md` |
| Participant artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` |

Current validated participants:

| Email | UUID | Type |
|-------|------|------|
| tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved |
| tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff |
| seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff |

Contract control remains `e2e-contract@record-platform.local` / `2ed75568-7deb-4c29-91b0-6919f24a0c9f` and does not count as a real participant.

---

## 3. Participant expansion requirement

T20.39B must require at least **5 complete participant rows** before an N=5 C-LIVE can proceed.

If the artifact remains at 3 complete rows, T20.39B may validate the current state but must **BLOCK N=5 C-LIVE**. Do not run another N=3 depth extension under T20.39 unless explicitly approved as a fallback.

Rejected substitutions:

- `@record-platform.local` accounts
- `t20-*` accounts
- `e2e-*` accounts
- contract personas
- Playwright disposables
- prior soak cohort users
- any staging/test user relabeled as real

---

## 4. Required fields for new rows

Each new counted participant row must include:

| Field | Required value |
|-------|----------------|
| Real email | Non-staging, non-test email |
| UUID / JWT sub | Exact authenticated JWT `sub` |
| Participant type | `real_owner_approved` or owner-approved `internal_staff` |
| Approval source | Owner approval reference |
| Consent confirmed | `yes` |
| Scope | `opt-in preview soak only` |
| Message bodies exposed? | `NO` |
| Production default approved? | `NO` |
| PERCENT > 0 approved? | `NO` |
| Signature / approval reference | Owner signature or chat approval reference |

Rows with missing values, placeholders, mismatched JWT subjects, or disallowed account classes do not count.

---

## 5. T20.39B validator plan

T20.39B must:

1. Run `scripts/audit-real-participant-artifact.sh`.
2. Verify artifact row completeness.
3. Verify JWT login and exact JWT `sub` match for all counted participants.
4. Reject staging/test/cohort/contract/disposable accounts.
5. Verify runtime remains KEEP:

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

6. Run preflight scripts:

```text
audit-rp-ai-rag-contract.sh
rp-ai-rag-quality-smoke.sh
audit-rp-ai-endpoints-contract.sh
rp-ai-provider-readiness.sh
rp-ai-pgvector-readiness.sh
rp-och-decontaminate-scan.sh
ai-quality-telemetry-report.mjs
```

7. Run preview UI smoke.
8. PASS only if **N >= 5** rows are complete and JWT verified.
9. BLOCK C-LIVE if **N < 5** or any row fails.

---

## 6. Proposed N=5 live matrix (T20.39C-LIVE only)

Default N=5 matrix:

```text
16 windows x 5 real participants x 5 runs/user/window x 9 cases/run = 3600 preview_opt_in
16 windows x 1 contract control x 5 runs/window x 9 cases/run       =  720 allowlist
Total                                                              = 4320
```

Expected gate counts:

```text
preview_opt_in = 3600
allowlist = 720
keyword_default during matrix = 0
```

---

## 7. Optional deeper N=5 matrix

The deeper N=5 matrix is **optional** and **not authorized** unless separately approved:

```text
24 windows x 5 real participants x 5 runs/user/window x 9 cases/run = 5400 preview_opt_in
24 windows x 1 contract control x 5 runs/window x 9 cases/run       = 1080 allowlist
Total                                                              = 6480
```

This is not the default T20.39C matrix.

---

## 8. C-LIVE gates

T20.39C-LIVE must satisfy:

| Gate | Requirement |
|------|-------------|
| HTTP 200 | 100% |
| Fallback | 0 target, <=1% hard max |
| `final_tagged_plan` fallback | 0 |
| Avg quality | >=3.5 |
| Worst quality | >=3.0 |
| Hybrid p95 | <=3000 ms |
| Canary errors | 0 |
| Soak-path telemetry WARNs | 0 |
| Leakage | PASS |
| OCH | PASS |
| Playwright C-suite | PASS |
| Guest preview hidden | PASS |
| Message-body exposure | 0 |
| PERCENT=0 | PASS |
| Post-revoke `keyword_default` | PASS for all real participants |

Only the clean final artifact counts. Failed early runs may be documented but must not be included in closeout totals.

---

## 9. Rollback requirements

T20.39D must verify:

1. UI enroll/revoke one real participant.
2. API enroll/revoke one different real participant.
3. Bulk revoke all real participants.
4. Verify all real participants -> `keyword_default`.
5. Verify contract control -> `allowlist`.
6. Run `CANARY=0` drill.
7. Restore KEEP env.

---

## 10. Decision options

| Option | Decision |
|--------|----------|
| A | Rollback preview UI/API |
| B | KEEP API runtime, hide UI |
| C | KEEP broader real-participant opt-in preview UI/API, PERCENT=0 |
| D | Recommend next readiness step only if N=5 gates pass |
| E | Approve hybrid/vector production default - **REJECT** |

Production default remains **keyword**. Vector and hybrid production defaults are **not approved**.

---

## 11. Runtime (unchanged)

```text
webapp:t20-p227b
python-ai-service:t20-p225b
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
Production default: keyword
API-only opt-in preview runtime: KEEP
Opt-in preview UI: KEEP
```

---

## 12. Verdict

```text
T20.39A: COMPLETE - design only
T20.39B: NOT STARTED
T20.39C-LIVE: NOT RUN
N=5 C-LIVE requires two additional complete owner-approved participant rows and separate approval
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
```

Next approval phrase:

```text
Approved: start T20.39B broader real-participant expansion validator audit only
```
