# T20.36A — Real-participant expansion readiness design

**Status:** Design / readiness **COMPLETE** — no live eval  
**Generated:** 2026-07-03  
**Baseline SHA:** `8af97b8`  
**Webapp:** `webapp:t20-p227b`  
**Python:** `python-ai-service:t20-p225b`

---

## 1. Objective

Move Phase 21 forward **without faking real-participant evidence**. T20.35A–H and T20.35B-REBLOCKED established that scope is owner-approved but **0/3 participant rows** are complete. T20.36A defines the **intake path**, **artifact validator**, and **future live matrix** so T20.36B+ can gate honestly on completed participant data.

**Out of scope for T20.36A:** C-LIVE, staging cohort substitution, participant row invention, runtime/env changes.

---

## 2. Owner-approved participant intake path (post-T20.35)

### 2.1 Artifact path

```text
docs/ai-platform/T20-35-owner-approved-real-preview-participants.md
```

Owner scope approval is recorded at `8af97b8`. Per-participant consent remains **pending** until ≥3 rows are complete and the “Participants listed below have owner approval / consent” box is checked.

### 2.2 Required fields per participant row

| Field | Requirement |
|-------|-------------|
| Email | Real address; not `TBD`, not staging alias |
| UUID / JWT sub | Verified UUID matching live JWT `sub`; not `TBD` |
| Participant type | `real_owner_approved` or owner-approved `internal_staff` |
| Approval source | Issue #, PR link, signed instruction, or owner artifact reference — not `TBD` |
| Consent confirmed | **`yes`** only (not `yes/no`, not blank) |
| Scope | `opt-in preview soak only` |
| Message bodies exposed? | **NO** |
| Production default approved? | **NO** |
| PERCENT > 0 approved? | **NO** |

### 2.3 Consent requirements

- Owner scope approval ≠ per-participant consent.
- Each row must record **consent confirmed: yes** from the participant or documented owner proxy for `internal_staff`.
- After ≥3 rows complete, owner checks “Participants listed below have owner approval / consent for preview testing.”

### 2.4 JWT sub verification (T20.36B+)

For each complete row:

1. Obtain JWT via approved login path (not staging eval script credentials unless explicitly listed as `internal_staff` with owner approval).
2. Decode JWT `sub` claim.
3. **PASS** only if `sub` equals artifact UUID exactly.
4. **FAIL** if login fails, sub mismatch, or UUID is placeholder.

### 2.5 Approval source format

Acceptable examples:

```text
GitHub issue #NNNN — owner comment YYYY-MM-DD
PR https://github.com/.../pull/NNNN — owner approval
Owner chat instruction YYYY-MM-DD (participant N)
Signed email / consent form on file (reference ID)
```

Not acceptable: `TBD`, inferred from staging cohort, or agent self-sign.

### 2.6 Signature / approval reference

Artifact-level signature (scope) is filled. Per-row approval source is still required. After all rows complete, owner may extend signature block with participant batch reference.

### 2.7 Explicit NOs (unchanged)

- No message-body exposure in UI or API
- No hybrid or vector production default
- No `AI_RAG_HYBRID_CANARY_PERCENT > 0`
- No permanent allowlist broadening
- No anonymous/guest hybrid access
- No relabeling staging/test cohort users as real participants

---

## 3. Strict artifact validator plan (T20.36B)

Validator runs **only when artifact file has changed** since last recorded audit. Do **not** re-run duplicate REBLOCKED docs for unchanged artifacts.

### 3.1 PASS criteria

- Artifact file exists and is committed
- ≥3 participant rows each pass all field checks (§2.2)
- Owner scope boxes remain consistent (NOT approved items still checked)
- JWT sub match verified for every counted participant
- Preflight scripts PASS (see T20.35B list)

### 3.2 FAIL / BLOCK criteria

**FAIL** if any counted row has:

- `TBD` in email, UUID, or approval source
- Consent not exactly `yes`
- Missing or placeholder signature/approval reference at row level
- Participant type outside `real_owner_approved` / owner-approved `internal_staff`
- JWT login failure or sub mismatch
- Staging cohort UUID without explicit `internal_staff` owner approval

**BLOCK** live eval on FAIL. Write one concise blocked/validator doc; do not run C-LIVE.

### 3.3 Validator output

| Result | Next step |
|--------|-----------|
| PASS (≥3 rows) | Authorize T20.35C-LIVE or T20.36C-LIVE (owner choice at approval time) |
| FAIL (<3 or incomplete) | T20.36B BLOCKED; no C-LIVE; no duplicate REBLOCKED unless artifact changed |

---

## 4. Future live matrix (validator PASS only)

### 4.1 Participants

- **N** = count of validator-passing real participants from artifact only
- **+1** contract allowlist control: `2ed75568-7deb-4c29-91b0-6919f24a0c9f`
- Staging 12-JWT cohort: **excluded**

### 4.2 Matrix dimensions

```text
8 windows × N real participants × 5 runs/user/window × 9 cases/run
+ 8 windows × 1 contract control × 5 runs × 9 cases/run
```

Expected counts:

```text
preview_opt_in = 8 × N × 5 × 9
allowlist      = 8 × 1 × 5 × 9  (= 360)
total          = preview_opt_in + allowlist
```

Example N=3: preview_opt_in = 1080, allowlist = 360, **total = 1440**.

### 4.3 Per-window flow

1. Revoke all preview enrollments
2. Verify real participants → `keyword` / `keyword_default`
3. Enroll real participants (API or UI per drill design)
4. Verify preview status → `preview_opt_in`
5. RAG probe → hybrid anchored / `preview_opt_in`
6. Verify contract user → `allowlist` / hybrid_canary
7. Verify `AI_RAG_HYBRID_CANARY_PERCENT=0`
8. Run live matrix (retry/backoff on 429)
9. Revoke all real participants post-window or post-batch per T20.35D pattern

---

## 5. C-LIVE gates (future)

| Gate | Threshold |
|------|-----------|
| HTTP 200 | 100% |
| Fallback | ≤1% |
| `final_tagged_plan` fallback | 0 |
| Avg quality | ≥3.5 |
| Worst quality | ≥3.0 |
| Hybrid p95 | ≤3000 ms |
| Canary errors | 0 |
| Soak-path telemetry WARNs | 0 |
| Leakage | PASS |
| OCH | PASS |
| Playwright (C-suite) | PASS |
| Guest preview hidden | PASS |
| Message-body exposure | 0 |
| PERCENT=0 | PASS |
| Post-revoke `keyword_default` | PASS |

---

## 6. Stop rules

| Condition | Action |
|-----------|--------|
| Artifact incomplete (<3 complete rows) | T20.36B **BLOCK** before live eval |
| Artifact unchanged since last REBLOCKED | **Do not** re-audit or duplicate blocked docs |
| Owner has not committed row updates | **Do not** run C-LIVE |
| Staging substitute proposed | **Reject** — not real-participant evidence |
| Validator FAIL | STOP; runtime/env/images unchanged |

---

## 7. Relationship to T20.35

| Ticket | State |
|--------|-------|
| T20.35A–H | CLOSED/BLOCKED |
| T20.35B-REBLOCKED | 0/3 complete rows recorded |
| T20.35 scope approval | `8af97b8` |
| T20.35C-LIVE | **NOT RUN** |
| T20.36A | Design/readiness **COMPLETE** |
| T20.36B | **NOT STARTED** — artifact validator audit |

When ≥3 rows are committed, owner may either:

- Re-open T20.35 path: `Approved: re-run T20.35B … proceed to T20.35C-LIVE`, or
- Continue T20.36: `Approved: start T20.36B real-participant artifact validator audit only`

---

## 8. Runtime (unchanged)

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
Cumulative staging live: 24705/24705 HTTP 200, 0% fallback
```

---

## 9. Verdict

```text
T20.36A: COMPLETE — design/readiness only
T20.36B: NOT STARTED — requires "Approved: start T20.36B real-participant artifact validator audit only"
T20.35C-LIVE: NOT RUN
Hybrid/vector production default: NOT APPROVED
```
