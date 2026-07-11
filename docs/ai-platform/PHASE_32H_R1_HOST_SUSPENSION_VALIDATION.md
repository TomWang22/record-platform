# Phase 32H-R1 — Host Suspension Validation

```text
Status: PLANNED
Workload: 8,640 probes per arm (2,880 per protocol)
Arms: baseline (normal power) vs caffeinate-protected
Production enablement: NOT APPROVED
```

## Hypothesis

Synchronized H1/H2/H3 latency extremes and aligned telemetry gaps (~350s, ~956s, ~112s, ~577s) in the blocked E3 run indicate **host sleep or suspend** during the matrix, not an application-layer RAG stall.

An H1-only replay cannot test this hypothesis. All three protocols must run together.

## Workload (identical in both arms)

```
3 protocols × 8 windows × 6 users × 10 runs × 6 cases = 8,640 probes
```

Per protocol: **2,880 probes**

### Cases (from Phase 32G/32H extreme timeline)

- `final_tagged_plan` (mandatory)
- `pricing_strategy`
- `listing_advice`
- `auction_pressure`
- `collector_metadata`
- `red_team_overclaim`

### Windows

Windows 1–8 (subset of the 16-window soak targeting extreme-associated windows).

## Arm A — Baseline (normal power)

- No `caffeinate`
- Pre-launch power snapshot under `power/pre-launch-power-snapshot.json`
- Six-probe capture smoke PASS required before matrix launch
- Full mandatory collector coverage or immediate arm BLOCKED

## Arm B — Protected (caffeinate)

- Identical manifest in separate root `/tmp/phase32h-r1-caffeinate`
- Scoped assertion: `caffeinate -dimsu -w <supervisor_pid>`
- Assertion PID and lifetime recorded in `power/caffeinate-assertion.json`
- If assertion disappears → arm BLOCKED

`caffeinate` is a controlled test-host remediation only. No production or service behavior changes.

## Causal gates

A host-suspension event is **CONFIRMED** only when direct evidence aligns:

- All shard heartbeats pause together
- Monitor/watchdog heartbeat pauses
- Host telemetry gap correlates
- Power logs show sleep/wake or equivalent
- PCAP has no packets during interval
- Gateway/application evidence does not show continuous processing
- Traffic resumes near wake
- In-flight curl completes after resume

Probable suspension without power event → **PARTIAL**, not confirmed.

## A/B decision rules

| Decision | Label | Condition |
| -------- | ----- | --------- |
| A | HOST_SLEEP_OR_SUSPEND CONFIRMED | Baseline reproduces sync stalls + sleep/wake evidence; protected arm clean |
| B | CLIENT_PROCESS_STALL | Host telemetry continuous; only runner/curl pauses |
| C | NETWORK/GATEWAY | Host/process continuous; PCAP/logs show gateway wait |
| D | UNRESOLVED | Reproduces but causal evidence incomplete |
| E | FULL_SOAK_REQUIRED | Neither arm reproduces extreme with complete evidence |

## Comparison outputs (uncommitted)

All under `/tmp/phase32h-r1-comparison/`:

- `phase32h-r1-baseline-summary.json`
- `phase32h-r1-protected-summary.json`
- `phase32h-r1-power-correlation.json`
- `phase32h-r1-process-correlation.json`
- `phase32h-r1-pcap-correlation.json`
- `phase32h-r1-ab-comparison.json`
- `phase32h-r1-root-cause-verdict.json`
- `phase32h-r1-final-report.md`

## Percentile guidance (n=2,880 per protocol)

| Percentile | Tail rows |
| ---------- | --------- |
| p99 | ~29 |
| p99.9 | ~3 |
| p99.99 | below one-row resolution |
| max | incident evidence, not SLO |

## Remediation (32H-D)

Only after confirmed cause:

- **Cause A:** staging-soak power-assertion wrapper + assertion-health guard + fail-closed on assertion loss
- **Cause B–C:** targeted client or gateway remediation per evidence
- **Cause D:** remain BLOCKED
- **Cause E:** full soak required; do not claim fixed because event did not reproduce

Production enablement remains NOT APPROVED for every outcome.
