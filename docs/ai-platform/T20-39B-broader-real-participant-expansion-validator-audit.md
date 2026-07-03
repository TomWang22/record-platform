# T20.39B — Broader real-participant expansion validator audit

**Status:** Validator **BLOCKED**  
**Generated:** 2026-07-03  
**Baseline SHA:** `1e60434`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Verdict

```text
T20.39B: BLOCKED — N=5 expansion requirement not met
T20.39C-LIVE: NOT RUN
Reason: artifact remains at 3 complete owner-approved/internal-staff rows; no two additional valid participants found
```

T20.39A requires **N >= 5** complete participant rows for N=5 expansion. The current artifact is valid for the existing N=3 set but does not meet the T20.39 expansion gate.

---

## 2. Current artifact state

| Check | Result |
|-------|--------|
| Artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` |
| Complete counted rows | **3** |
| Existing rows JWT-sub verified | **PASS** |
| Staging/test cohort excluded from counted rows | **PASS** |
| Required for T20.39 N=5 | **5** |
| N=5 gate | **BLOCKED** |

Existing valid participants:

| # | Email | UUID | Type | JWT sub match |
|---|-------|------|------|---------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | **PASS** |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | **PASS** |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | **PASS** |

No participant artifact update was made because adding partial or placeholder rows is prohibited.

---

## 3. Candidate discovery

Sources checked:

- Repo seed/auth scripts, including `scripts/init-auth-schema.sh`
- Current participant artifact and prior T20.36–T20.38 docs
- Local runtime auth database: `auth.users` in `record-platform-postgres-auth-1`
- Repo repair/consolidation scripts for non-local auth identities

Accepted candidates:

| Email | UUID | Reason |
|-------|------|--------|
| tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | Existing counted participant |
| tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | Existing counted participant |
| seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | Existing counted participant |

Rejected candidate classes:

| Candidate/class | Rejection reason |
|-----------------|------------------|
| `@record-platform.local` accounts | Staging/contract/dev class |
| `t20-*` accounts | Prior soak cohort, not real participants |
| `e2e-*` / `*-contract` accounts | Contract personas / controls only |
| `social-comp-*@example.com` | Generated social comprehensive test accounts |
| `auth-test-*`, `microservice-test-*`, `test-*` | Ephemeral test accounts |
| `k6-*`, `benchmark*`, `bench*`, load/stress accounts | Synthetic load/test accounts |
| Playwright/disposable generated users | Explicitly disallowed |
| Tom Wang consolidation duplicate identities | Not two distinct additional approved participants for N=5 expansion |

No two additional non-staging owner-approved/internal-staff participants were available to count.

---

## 4. Runtime env (unchanged KEEP)

```text
AI_RAG_HYBRID_CANARY=1
AI_RAG_HYBRID_CANARY_USER_ALLOWLIST=2ed75568-7deb-4c29-91b0-6919f24a0c9f
AI_RAG_HYBRID_CANARY_PERCENT=0
AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT=0
```

| Check | Result |
|-------|--------|
| CANARY=1 | **PASS** |
| Single contract allowlist only | **PASS** |
| PERCENT=0 | **PASS** |
| ALLOW_PROD_PERCENT=0 | **PASS** |
| Production default keyword | **PASS** |

---

## 5. Validator and preflight

| Check | Result |
|-------|--------|
| `scripts/audit-real-participant-artifact.sh` | **PASS for current N=3 artifact** |
| T20.39 N=5 row-count gate | **BLOCKED** |
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-och-decontaminate-scan.sh` | **PASS** (`__SCANNED__=590`) |
| `ai-quality-telemetry-report.mjs` | **PASS** (WARNs 0) |
| Preview UI smoke | **PASS** (`ai-rag-opt-in-hybrid-preview-ui.spec.ts` 4/4) |

Preflight is clean, but preflight success does not override the N=5 participant-row requirement.

---

## 6. Stop rule

```text
T20.39C-LIVE: NOT RUN
N=3 depth fallback: NOT RUN
Runtime/env/images: unchanged
Allowlist: unchanged
PERCENT: 0
Production default: keyword
```

## 7. Next required owner/data work

Before T20.39C-LIVE can be approved:

1. Add **two additional complete owner-approved participant rows** to `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`.
2. Commit that artifact update.
3. Re-run T20.39B validator audit.

Next approval phrase after artifact update:

```text
Approved: start T20.39B broader real-participant expansion validator audit only
```
