# Phase 32G — Timing-Attributed Repaired Long Soak

```text
Phase 32G: IN_PROGRESS
Evidence label: Phase 32G timing-attributed repaired long-soak matrix: 51840/51840 target
Controlled real inference: RUN
Production/live eval: NOT RUN
Production enablement: NOT APPROVED
Max outlier explained: NO (pending soak completion)
```

## Objective

Run the full **51,840-probe** repaired staging long soak with Phase 32F stall-capture fields enabled. Determine whether the Phase 31 ~1,037,645 ms latency outlier reproduces and is attributable, or does not reproduce under full timing attribution.

Do **not** claim production-ready from any outcome.

## Output root

```bash
OUT=/tmp/phase32g-timing-attributed-repaired-long-soak
```

Not merged into Phase 31D-R2 label or totals.

## Preflight

```bash
node scripts/phase32g-preflight-long-soak.mjs
make ai-platform-verify-phase32f-latency-rca
```

## Launch

```bash
node scripts/phase32g-launch-long-soak.mjs --out /tmp/phase32g-timing-attributed-repaired-long-soak
```

## Completion

```bash
node scripts/phase32g-summarize-long-soak.mjs --in "$OUT" --require-pass
node scripts/phase32f-stall-attribution-analyzer.mjs \
  --phase31 /tmp/phase31d-r2-repaired-staging-long-soak \
  --phase32d /tmp/phase32d-timing-attribution-micro-soak \
  --phase32e /tmp/phase32e-slow-kpi-write-durability \
  --phase32g "$OUT" \
  --out /tmp/phase32g-stall-attribution-analysis \
  --require-pass
```

## RCA outcome rules

| Outcome | Condition |
| ------- | --------- |
| `RCA_REPRODUCED_ATTRIBUTED` | max ≥ 300000 ms and one component ≥ 80% |
| `RCA_REPRODUCED_UNATTRIBUTED` | max ≥ 300000 ms, no component ≥ 80% |
| `RCA_NOT_REPRODUCED_FULL_SOAK` | max < 60000 ms and all gates PASS |
| `BLOCKED` | any quality gate fails |

## Verify

```bash
make ai-platform-verify-phase32g-long-soak
```

Artifacts under `/tmp` only — not committed.
