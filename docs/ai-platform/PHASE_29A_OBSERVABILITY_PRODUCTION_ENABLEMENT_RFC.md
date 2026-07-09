# Phase 29A — Observability Production Enablement RFC

```text
Phase 29A: PASS
Phase 29: IN_PROGRESS
Live eval run: NOT RUN
Production DB migration: NOT RUN
Runtime/env/default/allowlist changes: NONE
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
Production enablement: NOT APPROVED
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Root question

Can KPI observability be safely enabled toward production readiness **without** changing retrieval defaults, **without** PERCENT rollout, **without** private-data leakage, and with enough real-inference + pipeline durability evidence to justify a **future** production enablement decision?

## Decision options

| Option | Description | Production default | PERCENT | Enablement |
| ------ | ----------- | ------------------ | ------- | ---------- |
| **A** | Do nothing / KEEP default-off | keyword | 0 | NOT APPROVED |
| **B** | Controlled staging enablement only | keyword | 0 | staging/non-prod KPI flags only during drills |
| **C** | Limited production KPI observability behind master/global/channel flags | keyword | 0 | recommend only if 29B–29H PASS; **not performed in Phase 29** |
| **D** | Reject production enablement pending more data | keyword | 0 | NOT APPROVED |

**Recommended default:** Option **B** unless all gates PASS and owner explicitly approves C.

## Hard stops (all options)

```text
No production default change.
No PERCENT rollout.
No ALLOW_PROD_PERCENT rollout.
No hybrid/vector production default.
No production DB migration unless separately approved with target DB named.
No permanent production KPI write enablement.
No participant artifact edits.
No merging Phase 29 25920 into Phase 22 57105/171315 evidence.
No committed /tmp KPI reports or bench logs.
```

## Evidence separation

```text
Phase 22: 57105/57105 per protocol (full labeled parity)
Phase 28: 25920 production-readiness matrix (CLOSED PASS)
Phase 29: 25920 production-enablement matrix (separate label)
```

## Gate chain (29B–29J)

Preflight → env readiness → pipeline durability → real-inference matrix → KPI report → rollback → go/no-go → archive.

## Risks

- Mistaking Phase 29 matrix for Phase 22 parity or production rollout
- Enabling KPI flags without rollback proof
- Leakage of prompts/responses/JWT into KPI tables
- Transient gateway errors polluting gate_reason metrics
- NOT merged into 57105/171315 totals

## Acceptance

RFC complete with options A–D, hard stops, and gate chain documented.
