# T20.39B3 — Owner-approved internal-staff participant provisioning

**Status:** Provisioning **PASS** — artifact updated to N=5  
**Generated:** 2026-07-03  
**Baseline SHA:** `7aaa7fe`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Verdict

```text
T20.39B3: PASS
Participant artifact: N=3 → N=5
New participants: 2 owner-approved internal_staff preview participants
T20.39B validator re-run: NEXT
T20.39C-LIVE: NOT RUN in this step
```

This step provisions two owner-approved `internal_staff` preview participants so T20.39 can move from the blocked N=3 state to the required N=5 validator re-run.

---

## 2. Artifact change

| Item | Value |
|------|-------|
| Original artifact SHA256 | `2f540e4b01fa1a5e8ea4eafbe4d2e86f9cd27007307176574d2cb5a8f69166c1` |
| New artifact SHA256 | `1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa` |
| Original participant count | **3** |
| New participant count | **5** |
| Existing rows preserved | **PASS** |
| New rows appended | **PASS** |

New rows:

| # | Email | UUID | Type |
|---|-------|------|------|
| 4 | phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | internal_staff |
| 5 | phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | internal_staff |

Approval source for both rows:

```text
Owner chat instruction approving T20.39B3 internal_staff participant provisioning for opt-in hybrid preview N=5 soak — 2026-07-03
```

Signature:

```text
Tom Wang / repository owner — 2026-07-03
```

---

## 3. Auth provisioning

Tool:

```text
scripts/t20-39b3-provision-internal-staff-participants.mjs
```

Safety behavior:

- Reuses an existing UUID if either target email already exists.
- Creates exactly two target rows if missing.
- Reuses the existing auth seed password-hash pattern.
- Emits intake JSON under `bench_logs/ai-platform/t20-39b3/` only.
- Emits a redacted DB diff before/after provisioning.
- Does not print or persist passwords or JWTs.
- Cleans up newly inserted rows if JWT verification fails before intake.

DB diff:

| Check | Result |
|-------|--------|
| Before target rows | `0` |
| After target rows | `2` |
| Created rows | `2` |
| Reused rows | `0` |
| Before hash | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| After hash | `169897b6d174730b425f82c9c5ebe72ed5f2c900cafa64657cf3edc49474d895` |

---

## 4. JWT verification

| Email | Expected UUID | JWT sub match |
|-------|---------------|---------------|
| phase21-preview-internal-1@example.com | `8f0f4a52-8e01-4f8f-9c31-1c3b3949d101` | **PASS** |
| phase21-preview-internal-2@example.com | `b3d9d25b-4f37-4c7f-a7db-48f3c97a02c2` | **PASS** |

N=5 artifact audit after intake:

```text
T20_MIN_PARTICIPANT_ROWS=5 scripts/audit-real-participant-artifact.sh
```

Result:

```text
participant rows validated (5)
JWT sub match for all participants
staging cohort excluded from artifact rows
PASS
```

---

## 5. Intake results

| Step | Result |
|------|--------|
| Intake dry-run | **PASS** — final participant count 5 |
| Intake write | **PASS** — final participant count 5 |
| Artifact audit | **PASS** — 5/5 JWT-sub verified |

No staging/test/e2e/t20/contract users were counted. The new participants are owner-approved `internal_staff` preview participants only; they are not contract controls and not production-default rollout users.

---

## 6. Runtime/env safety

| Check | Result |
|-------|--------|
| Runtime/env/images changed | **NO** |
| Permanent allowlist broadened | **NO** |
| `AI_RAG_HYBRID_CANARY_PERCENT` changed | **NO** |
| `AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT` changed | **NO** |
| Hybrid/vector production default enabled | **NO** |
| Message bodies exposed | **NO** |
| Anonymous/guest hybrid access enabled | **NO** |
| Keyword fallback / overlap anchors removed | **NO** |

---

## 7. Next gate

Proceed to T20.39B validator re-run. C-LIVE remains blocked unless the N=5 validator re-run passes all artifact, preflight, telemetry, and preview UI smoke gates.

