# Phase 32G — Timing-Attributed Repaired Long Soak

```text
Phase 32G: PASS
Evidence label: Phase 32G timing-attributed repaired long-soak matrix: 51840/51840 target
Controlled real inference: RUN (completed)
Production/live eval: NOT RUN
Production enablement: NOT APPROVED
RCA outcome: RCA_REPRODUCED_ATTRIBUTED
Phase 31 ~1,037,645 ms tier reproduced: YES (~1,008,863 ms max wall)
Max outlier explained (stall analyzer): NO — curl/starttransfer attributed; production still NOT APPROVED
Phase 32H: NOT STARTED
```

## Closeout summary

| Item | Result |
| ---- | ------ |
| HEAD SHA | `46bb0f0c372b0ad3c327731196c3027650275e67` |
| Matrix | **51840/51840** (HTTP/1.1=17280, HTTP/2=17280, HTTP/3=17280) |
| wrong_gate | 0 |
| wrong_protocol | 0 |
| fallback | 0 |
| leakage | 0 |
| response / sentiment / red-team | 100% / 100% / 100% |
| timing coverage | 100% all fields |
| private-field leakage | PASS |
| `make ai-platform-verify-phase32g-long-soak` | PASS |
| stall analyzer | PASS (`max_outlier_explained: false`) |

## Evidence root

```bash
OUT=/tmp/phase32g-timing-attributed-repaired-long-soak
```

Stale pre-CI evidence isolated at `/tmp/phase32g-stale-pre-ci-cleanup-9495818-20260710-225311` — **not merged**.

Not merged into Phase 31D-R2 label or Phase 22/28/29/30/31 totals.

## Restart history

One monitor-initiated restart recorded in `phase32g-restart-ledger.json`:

| At | Protocol | Reason |
| -- | -------- | ------ |
| 2026-07-11T05:40:31Z | h2 | `runner_exit_before_target` |

h2 resumed with `--resume`; matrix completed 17280/17280 per shard. Max wall outlier (probe 11925) has `shard_restart_count=0` — no direct restart correlation.

## Latency distribution (wall ms by protocol)

| Protocol | p50 | p95 | p99 | p99.9 | p99.99 | max |
| -------- | --- | --- | --- | ----- | ------ | --- |
| HTTP/1.1 | 948 | 2473 | 5589 | 7136 | ~top 1–2 rows | 1,007,351 |
| HTTP/2 | 953 | 2519 | 5567 | 6677 | ~top 1–2 rows | **1,008,863** |
| HTTP/3 | 947 | 2450 | 5561 | 6984 | ~top 1–2 rows | 1,008,713 |

**Seven-nines note:** With n=17,280 per protocol, p50–p99 and p99.9 are empirically measurable; p99.99 is effectively the worst 1–2 rows; p99.999+ lacks independent resolution; p100/max is incident-forensics only.

Typical experience (p50 ~950 ms) is healthy. Extreme tail (max ~17 min) is isolated — not representative of p95/p99.

## RCA verdict

| Question | Answer |
| -------- | ------ |
| Phase 31 ~1,037,645 ms outlier reproduced? | **YES** (~97% of Phase 31 max) |
| Worst wall row dominant component? | **curl_time_total_ms / starttransfer** (~99.9% of wall on probe 11925) |
| Coordinator lifecycle? | Measured **outside** per-probe wall; not wall-latency outlier |
| KPI write path? | Excluded (Phase 32E); max KPI write 972,347 ms on separate probe, not wall-dominant |
| Production enablement justified? | **NO** |

Top wall outlier: probe 11925, HTTP/2, `final_tagged_plan`, window 23, run 5 — wall=1,008,863 ms, curl=1,008,311 ms, server_rag=4,213 ms.

Stall analyzer conclusion: `RCA_REPRODUCED_ATTRIBUTED` at matrix summarize level; `max_outlier_explained: false` at Phase 32F analyzer — **STAGING CONTINUE**, production enablement **NOT APPROVED**.

## Completion commands (executed)

```bash
node scripts/phase32g-summarize-long-soak.mjs --in "$OUT" --require-pass
node scripts/phase32f-stall-attribution-analyzer.mjs \
  --phase31 /tmp/phase31d-r2-repaired-staging-long-soak \
  --phase32d /tmp/phase32d-timing-attribution-micro-soak \
  --phase32e /tmp/phase32e-slow-kpi-write-durability \
  --phase32g "$OUT" \
  --out /tmp/phase32g-stall-attribution-analysis \
  --require-pass
make ai-platform-verify-phase32g-infra
make ai-platform-verify-phase32g-long-soak
```

## Artifacts (/tmp only — not committed)

- `phase32g-final-latency-telemetry-report.json`
- `phase32g-final-latency-telemetry-report.md`
- `phase32g-interim-latency-telemetry-report.json` (interim snapshot)
- `/tmp/phase32g-stall-attribution-analysis/`

## RCA outcome rules

| Outcome | Condition |
| ------- | --------- |
| `RCA_REPRODUCED_ATTRIBUTED` | max ≥ 300000 ms and one component ≥ 80% |
| `RCA_REPRODUCED_UNATTRIBUTED` | max ≥ 300000 ms, no component ≥ 80% |
| `RCA_NOT_REPRODUCED_FULL_SOAK` | max < 60000 ms and all gates PASS |
| `BLOCKED` | any quality gate fails |

**Observed:** `RCA_REPRODUCED_ATTRIBUTED` — extreme tail reproduced and curl/starttransfer dominates worst wall rows.

## Next allowed step

Owner decision on **Phase 32H** (post-32G remediation / staging-continue package). Phase 32H is **NOT STARTED**. Production default remains **keyword**, `PERCENT=0`, `ALLOW_PROD_PERCENT=0`.
