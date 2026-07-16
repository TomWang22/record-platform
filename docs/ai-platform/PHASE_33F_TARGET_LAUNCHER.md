# Phase 33F committed target launcher

## Scope

Implementation + validation only. Does **not** launch
`/tmp/phase33f-capability-gauntlet-target-v1` (17,280 probes).

## Entrypoints

| Script | Role |
|--------|------|
| `scripts/phase33f-launch-capability-target.mjs` | Real target launcher (owner-gated) |
| `scripts/phase33f-target-launcher-smoke.mjs` | Live 72-probe H1/H2/H3 smoke (dedicated root) |
| `scripts/lib/phase33f-capability-launch-core.mjs` | Shared orchestration (canary + target) |
| `scripts/lib/phase33f-target-preflight.mjs` | Target-only preflight + approval gates |

## Approval isolation

Target launch requires **both**:

- `PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_SHA` === HEAD
- `PHASE33F_TARGET_OWNER_LAUNCH_APPROVED_ROOT` === `/tmp/phase33f-capability-gauntlet-target-v1`

Canary `PHASE33F_OWNER_LAUNCH_APPROVED_SHA` must never authorize target mode.
The canary launcher still refuses the real target root.

## Pins

- Manifest SHA: `d97194d7a72ff1324c2d281d857d84dee18b4ed837c880e2972b2f753ed14f3c`
- Workload hash (`phase33f-workload-v1`): `4e4415b008f0347d0fccd02a114dc0a98621944b859ca4754aaa6f5ee9af86b1`

Mismatch → `PHASE33F_TARGET_MANIFEST_PIN_MISMATCH`.

## Smoke

Root: `/tmp/phase33f-target-launcher-smoke-v1`

72 probes / 24 synchronized triplets / H1+H2+H3 / `phase33f-rate-v1` (1000 ms).

## Verify

```bash
make ai-platform-verify-phase33f-target-manifest
make ai-platform-verify-phase33f-target-launcher
make ai-platform-verify-phase33f-target-preflight
make ai-platform-verify-phase33f-target-readiness
```

Production remains **NOT APPROVED**. Soak is separately gated.
