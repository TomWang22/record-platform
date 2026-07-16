# Phase 33F target readiness (observability + workload hash)

## Canonical workload hash

- **Manifest SHA** hashes the exact ordered probe-row array (`hashManifest`).
- **Canonical workload hash** (`phase33f-workload-v1`) hashes normalized logical
  coordinates only (capability, scenario, scopes, expected results, fixture hash,
  protocol, seed). It must not equal the manifest SHA.
- Historical `0e20147d…` was a legacy subset hash of
  `probe_id/batch_id/capability/protocol/seed`.
- Copying the manifest SHA into `canonical_workload_hash` is classified as
  `CANONICAL_WORKLOAD_HASH_REPORTING_DEFECT`.

## Runner resource telemetry

The capability runner emits bounded JSONL at
`telemetry/runner-resource-telemetry.jsonl` (workers, MessagePorts/worker
threads, listeners, active handles, heap/RSS). The read-only status CLI streams
a tail only — it does not load full history.

## Target launcher

See [PHASE_33F_TARGET_LAUNCHER.md](./PHASE_33F_TARGET_LAUNCHER.md). The committed
target launcher is separate from the canary launcher and uses dedicated approval
env vars. This package still does not auto-launch the 17,280-probe target.

## Target root

`/tmp/phase33f-capability-gauntlet-target-v1` requires a separate exact-SHA owner
approval after target-launcher READY. This package does not launch it.
