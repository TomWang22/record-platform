# Phase 31L — Preview Lifecycle Repair

```text
Phase 31L: PASS
Phase 31: BLOCKED (parent unchanged)
Repair implemented: shared preview window coordinator + pre-probe gate verification + JWT identity validation
Coordinator prevents mid-window global revoke: YES
Single reset per window: YES
All protocols complete window before next reset: YES
Pre-probe gate verification: YES (one re-enroll attempt during window reset only)
JWT sub/x-user-id validation: YES (artifact uid must match JWT sub before matrix)
Deterministic keyword_default mismatch remains BLOCKED: YES
Tests: PASS
Targeted replay: NOT RUN
Full replay: NOT RUN
31E–31J: NOT RUN
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT enabled
Bench logs committed: NO
Generated reports committed: NO
```

## Repair summary

Parallel h1/h2/h3 matrix shards now coordinate preview lifecycle through a shared window coordinator under the matrix root:

```text
/tmp/phase31-staging-long-soak-matrix/window-coordinator/state.json
/tmp/phase31-staging-long-soak-matrix/window-coordinator/lock/
```

Behavior:

1. Only the first shard entering window N performs global preview revoke/enroll + gate verification.
2. Other shards wait on the coordinator lock, then observe `gate_verified=true` without re-revoking.
3. No shard may enter window N+1 until `completed_protocols` for window N includes h1, h2, and h3.
4. Gate verification requires preview participants => `preview_opt_in`, contract => `allowlist`.
5. HTTP 200 + expected `preview_opt_in` + observed `keyword_default` remains **deterministic BLOCKED** (never retryable).

## Files

```text
scripts/lib/phase31-preview-window-coordinator.mjs
scripts/phase31-controlled-observability-matrix-runner.mjs
scripts/lib/phase31-controlled-matrix-summary.mjs
scripts/phase31-extract-controlled-matrix-failures.mjs
tests/phase31-preview-window-coordinator.test.mjs
tests/phase31-preview-lifecycle-repair.test.mjs
```

## Verification

```bash
make ai-platform-verify-phase31-lifecycle-repair
make ai-platform-verify-phase31-preflight
```

## Next step

Approved: start **Phase 31M** targeted preview lifecycle replay only after Phase 31L repair PASS — affected windows/users/protocols only, no full soak, no production enablement.
