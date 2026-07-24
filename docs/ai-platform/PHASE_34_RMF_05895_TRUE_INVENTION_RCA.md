# Phase 34 — RMF-05895 True Model Invention RCA

**Classification:** `TRUE_MODEL_INVENTION` contained
**Customer exposure:** NONE
**Final customer path:** `DETERMINISTIC_FALLBACK_AFTER_GUARD`
**Model tier:** `llama3.2:1b` — `TRANSPORT_AND_SMOKE_ONLY` / `MODEL_TIER_INSUFFICIENT`
**Production:** NOT APPROVED

## Non-negotiable posture

- Do not mutate or resume frozen v3 (`/private/tmp/phase34-real-model-full-eval-v3`).
- Do not whitelist `45`.
- Do not loosen numeric invention checks.
- Do not silently convert guard rejection into PASS.
- v4 is replication / failure-rate characterization only (same insufficient model; began before remediation).

## Incident identity

| Field | Value |
| --- | --- |
| Frozen source root | `/private/tmp/phase34-real-model-full-eval-v3` |
| Session | `rmf-05895` |
| Capability | `auction_intelligence` |
| Unsupported material claim | draft sale price `$45` |
| Supported numeric set | `{3, 4, 12, 35, 40, 42, 50}` |
| Guard result | CORRECT REJECTION |
| Unsupported claims escaped | `0` |

## Claim-index mismatch (must stay documented)

| Observation | Value |
| --- | --- |
| Recorded `claim.index` | `53` |
| `"$45"` position in retained snippet | `194` |
| Classification | `MODEL_ATTEMPT_PROVENANCE_INCOMPLETE` |

Do **not** guess which attempt produced index `53`. Future attempt-level provenance (invocation ledger with independent `model_invocation_id`, `attempt_index`, and output hashes) repairs this gap.

## Verdicts for the incident

```text
V3: TERMINAL_BLOCKED — TRUE_MODEL_INVENTION CONTAINED
UNSUPPORTED CLAIMS ESCAPED: 0
MODEL QUALITY FAILURES: 1
SAFETY CONTAINMENT: PASS FOR THE INCIDENT
PRODUCT QUALITY ACCEPTANCE: BLOCKED
MODEL TIER: INSUFFICIENT
PRODUCTION: NOT APPROVED
```

Distinction:

1. Guard system succeeded.
2. Model generation failed.
3. Customer-safe deterministic fallback succeeded.
4. Overall model-quality evaluation still failed.

## Sanitized dossier location

External (full JSON, hashes only — no secrets):

- `/tmp/phase34-real-model-full-eval-v3-analysis/rca-rmf-05895/dossier.json`

This markdown retains the durable classification and invariants for Git.

## Related replication (v4)

v4 froze with a second uncommon invention (`rmf-12528`, negotiation `$47`). That confirms stochastic invention under the 1B smoke tier; it does **not** prove remediation.
