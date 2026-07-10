# Phase 31M — Targeted Preview Lifecycle Replay

## Result

```text
Phase 31M: PASS
Targeted replay: 3672/3672
HTTP/1.1: 1224/1224
HTTP/2: 1224/1224
HTTP/3: 1224/1224
wrong_gate=0
wrong_protocol=0
fallback=0
leakage=0
response_pass=100%
red_team_safety=100%
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT enabled
```

## Scope

Targeted replay of affected windows, runs, users, and protocols after Phase 31L coordinator repair and Phase 31M runner repair.

| Parameter | Value |
|-----------|-------|
| OUT | `/tmp/phase31-preview-lifecycle-repair-replay` |
| Windows | 3, 4, 5, 16–23, 25–30 (17 windows) |
| Runs | 7, 8, 9, 10 |
| Users | Contract allowlist + affected preview user `4c6830b9d086` |
| Protocols | h1, h2, h3 in parallel |
| Total | 3,672 (1,224 per protocol) |

## Gate checks

| Check | Result |
|-------|--------|
| Preview rows | 1,836 |
| `preview_opt_in` observed | 1,836 |
| `preview_keyword_default` observed | 0 |
| Contract rows | 1,836 |
| Contract `allowlist` observed | 1,836 |
| Leakage failures | 0 |
| Fallback | 0 |

## Repair lineage

- **31K:** Root cause — uncoordinated parallel shard window resets
- **31L:** Shared preview window coordinator
- **31M runner repair:** `567e98e` — duplicate export, non-consecutive `windowSequence`, summarizer `path` import

## Next step

See `PHASE_31N_FULL_SOAK_REPLAY_DECISION.md` — **Decision B:** Phase 31D-R2 full repaired 51,840 staging long-soak required before 31E–31J closeout.
