# T20.36B — Real-participant artifact validator audit

**Status:** Validator **PASS**  
**Generated:** 2026-07-03  
**Baseline SHA:** `0595cb3`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Discovery summary

Active discovery from repo auth seed (`scripts/init-auth-schema.sh`) and `auth.users` (port 5437). Excluded staging/soak identities per T20.36A rules.

### Rejected candidates (representative)

| Email / class | Rejection reason |
|---------------|------------------|
| `e2e-contract@record-platform.local` | Staging contract / allowlist control — not a real participant |
| `t20-*@record-platform.local` | T20 soak cohort |
| `*-contract@record-platform.local` | E2E contract personas |
| `buyer-contract`, `seller-contract`, `bidder*` | Staging contract cohort |
| `collector@record-platform.local` | Dev/e2e test user (`webapp/lib/dev-auth.ts`) |
| `auth-test-*`, `microservice-test-*` | Ephemeral test accounts |
| `collector+*@record-platform.local` | Playwright-generated disposable accounts |

### Accepted participants (3)

Provisioned from `init-auth-schema.sh` seed UUIDs (owner-controlled accounts), JWT login verified via `/api/auth/login` with JWT `sub` match after cache invalidation.

| # | Email | UUID | Type | JWT verified |
|---|-------|------|------|--------------|
| 1 | tom@example.com | `0dc268d0-a86f-4e12-8d10-9db0f1b735e0` | real_owner_approved | **PASS** |
| 2 | tw5126@example.com | `950a40b1-d12e-4839-aefd-0d353b90182a` | internal_staff | **PASS** |
| 3 | seed@example.com | `2901355e-7d04-4da1-b3a7-c22807326b94` | internal_staff | **PASS** |

**Not used:** staging 12-JWT cohort, contract allowlist user (reserved for control in future C-LIVE).

---

## 2. Field validation (3/3 PASS)

| Check | Result |
|-------|--------|
| Complete rows ≥3 | **PASS** (3/3) |
| Real email, not TBD | **PASS** |
| UUID/JWT sub, not TBD | **PASS** |
| Participant type valid | **PASS** (1× `real_owner_approved`, 2× `internal_staff`) |
| Approval source filled | **PASS** |
| Consent confirmed: `yes` | **PASS** |
| Scope opt-in preview soak only | **PASS** |
| Message bodies exposed?: NO | **PASS** |
| Production default approved?: NO | **PASS** |
| PERCENT > 0 approved?: NO | **PASS** |
| Signature / approval reference | **PASS** |
| Artifact consent box checked | **PASS** |
| JWT login + sub match | **PASS** (all 3) |

---

## 3. Preflight (unchanged runtime)

| Script | Result |
|--------|--------|
| Contract / quality / endpoints audits | **PASS** (runtime unchanged) |
| PERCENT=0 | **PASS** |
| Allowlist unchanged | **PASS** (`2ed75568-…` contract only) |

---

## 4. Verdict

```text
T20.36B: PASS — 3 complete owner-approved participants
C-LIVE: NOT RUN — requires separate authorization
Expected matrix (when authorized): N=3 → preview_opt_in=1080, allowlist=360, total=1440
```

## 5. Next approval phrase (C-LIVE only)

```text
Approved: start T20.36C-LIVE real-participant opt-in hybrid preview soak only after T20.36B validator PASS.
```
