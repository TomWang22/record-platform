# T20.39B2 — Real-participant artifact intake tooling

**Status:** Tooling **COMPLETE** — no live eval  
**Generated:** 2026-07-03  
**Baseline SHA:** `a4207eb`  
**Artifact:** `docs/ai-platform/T20-35-owner-approved-real-preview-participants.md`

---

## 1. Objective

T20.39B blocked because the owner-approved participant artifact remained at **N=3** and no two additional valid participants were available to discover. T20.39B2 adds intake tooling so owner-provided rows can be appended safely once the two real participants exist.

This step does not authorize C-LIVE, another N=3 soak, runtime/env/image changes, allowlist broadening, percentage rollout, or production default changes.

---

## 2. Tool

```bash
node scripts/t20-real-participant-artifact-intake.mjs --input /tmp/participants.json --dry-run
node scripts/t20-real-participant-artifact-intake.mjs --input /tmp/participants.json --write
```

The script accepts JSON from `--input <path>` or `T20_REAL_PARTICIPANTS_JSON`.

It validates all rows before making any artifact changes. If any candidate fails validation, the tool exits non-zero and writes nothing.

Validation includes:

- Email must be real, non-placeholder, and non-staging/test.
- UUID must be a valid UUID.
- `participantType` must be `real_owner_approved` or `internal_staff`.
- `approvalSource` must be filled and not TBD.
- `consentConfirmed` must be exactly `yes`.
- `signature` must be filled and not TBD.
- Duplicate emails or UUIDs are rejected against existing and pending rows.
- Explicit approval and explicit NOT-approved checkboxes must remain checked.
- New rows are appended with scope `opt-in preview soak only` and hard-stop fields `NO | NO | NO`.

Rejected account classes include `@record-platform.local`, `t20-*`, `e2e-*`, `*-contract`, `auth-test-*`, `microservice-test-*`, `test-*`, `k6-*`, `benchmark*`, Playwright accounts, disposable accounts, and generated accounts.

---

## 3. Exact JSON template

Use this shape for the two owner-approved rows. Replace every placeholder before running the tool.

```json
[
  {
    "email": "person-one@example.com",
    "uuid": "00000000-0000-0000-0000-000000000000",
    "participantType": "real_owner_approved",
    "approvalSource": "Owner approval reference for first participant — 2026-07-03",
    "consentConfirmed": "yes",
    "signature": "Tom Wang / repository owner — 2026-07-03"
  },
  {
    "email": "person-two@example.com",
    "uuid": "00000000-0000-0000-0000-000000000000",
    "participantType": "internal_staff",
    "approvalSource": "Owner approval reference for second participant — 2026-07-03",
    "consentConfirmed": "yes",
    "signature": "Tom Wang / repository owner — 2026-07-03"
  }
]
```

Owner runbook once two rows are available:

```bash
node scripts/t20-real-participant-artifact-intake.mjs --input /tmp/t20-39-real-participants.json --dry-run
node scripts/t20-real-participant-artifact-intake.mjs --input /tmp/t20-39-real-participants.json --write
scripts/audit-real-participant-artifact.sh
```

The artifact update should be committed separately before re-running the T20.39B validator audit.

---

## 4. Tests

```bash
node --test tests/t20-real-participant-artifact-intake.test.mjs
```

Coverage includes valid two-row append to N=5, rejection of TBD email, invalid UUID, `@record-platform.local`, `t20-*`, `e2e-*`, duplicate UUID, non-`yes` consent, blank approval source, and dry-run no-write behavior.

---

## 5. T20.39B re-run prompt

After the two rows are available and the intake tool has appended them:

```text
Use the T20.39B2 intake tool to append these two owner-approved participants, then re-run T20.39B validator audit only. Do not run C-LIVE.
```

T20.39B PASS still requires N >= 5 complete rows, JWT login and exact JWT `sub` match for all counted rows, staging/test rejection, preflight PASS, preview UI smoke PASS, runtime/env unchanged, and PERCENT=0.

---

## 6. T20.39C-LIVE approval prompt after N=5 validator PASS

Use only after the N=5 artifact update is committed and T20.39B validator audit passes:

```text
Approved: start T20.39C-LIVE broader real-participant N=5 hybrid preview evaluation only if T20.39B validator PASS remains current.

Run the approved N=5 matrix only:

16 windows × 5 real participants × 5 runs/user/window × 9 cases/run = 3600 preview_opt_in
16 windows × 1 contract control × 5 runs/window × 9 cases/run = 720 allowlist
Total = 4320

Do NOT broaden permanent allowlist.
Do NOT enable hybrid or vector production default.
Do NOT set AI_RAG_HYBRID_CANARY_PERCENT above 0.
Do NOT set AI_RAG_HYBRID_CANARY_ALLOW_PROD_PERCENT above 0.
Do NOT expose message bodies.
Do NOT enable anonymous/guest hybrid access.
Do NOT remove keyword fallback or overlap anchors.
Do NOT use staging/test/e2e/t20/contract/disposable users.
Stop immediately if validator freshness, preflight, preview UI smoke, leakage, OCH, WARN, rollback, or post-revoke gates fail.
```

---

## 7. Verdict

```text
T20.39B2: COMPLETE — intake tooling only
Artifact: unchanged at N=3 until owner-provided JSON is supplied
T20.39B: COMPLETE/BLOCKED pending two additional rows
T20.39C-LIVE: NOT RUN
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
```

