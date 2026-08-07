# Canary-v3 PREPARED Read-Only Live Probe Design

**Date:** 2026-08-06  
**Status:** design-only  
**Parent:** `2026-08-06-record-platform-performance-and-lineage-master-design.md`  
**Track:** A / Ticket 2  
**Depends on:** Ticket 1 provenance validation (fail-closed)  
**execution_authorized:** false

## Goal

Under the PREPARED (not authorized) live-window packet, prove production adapters can observe the live environment safely, freeze real pins, and never start the one-hour canary-v3 window.

## Runner

```text
scripts/run-auction-monitor-canary-v3-readonly-live-probe.py
  --packet reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json
  --out reports/outbox/canary-v3-live-readonly-probe.json
```

Sidecar: `reports/outbox/canary-v3-live-readonly-probe.sha256`

Uses `ProductionAdapterBundle(allow_readonly_probe=True, require_packet_authorized=False)`.

## Allowed operations

```text
inspect runtime pin
inspect Docker execution plane
inspect query-plane TLS chain
describe Kafka partitions (allowlisted command only)
capture DB T0 (read-only)
capture metric-series presence (Ticket 1 series)
capture observability denominators
freeze the publisher log cursor
```

## Forbidden operations

```text
trigger a publisher invocation
claim a one-hour database equation
change throughput
write outbox rows
start canary-v3
authorize the live window
mutate packet status away from PREPARED_NOT_AUTHORIZED
```

## Fail-closed Ticket 1 precondition

Until Ticket 1 counters exist and independent auditor recomputation validates provenance artifacts:

```text
verdict = DB_PROVENANCE_NOT_READY
```

Must **not** emit `READ_ONLY_LIVE_PROBE_PASS`. Must **not** fill packet placeholders.

Ticket 2 PASS gate requires:

```text
Ticket 1 provenance artifacts validated
all four counter series present
common T0/T1 interval proven (fixture or short no-mutation probe interval)
auditor recomputation PASS
```

A short probe interval for series presence is **not** a canary equation claim.

## Capture fields

### Runtime pin

```text
auction-monitor pod name and UID
image digest
RP_SOURCE_SHA
OCI revision
deployment generation
restart count
```

### Docker execution plane

```text
Colima profile
DOCKER_HOST
Docker context
exact PostgreSQL container ID / name / image digest
```

### Jaeger query plane

```text
hostname = jaeger.record-platform.test
MetalLB IP
SNI hostname
leaf / intermediate / root SHA-256
certificate path verified
/api/services HTTP 200
localhost_queries = 0
port_forward_queries = 0
fallback_queries = 0
```

### Kafka / DB / observability

```text
topic description via allowlisted command
partition leader map
DB T0 read-only capture
publisher log cursor
observability pod/container denominators
Jaeger/OTEL restart and OOM counts
```

## Report contract (`canary-v3-live-readonly-probe/v1`)

PASS only when:

```json
{
  "schema": "canary-v3-live-readonly-probe/v1",
  "verdict": "READ_ONLY_LIVE_PROBE_PASS",
  "cluster_mutation_attempted": false,
  "publisher_invocation_triggered": false,
  "outbox_rows_mutated": 0,
  "throughput_changed": false,
  "packet_status_unchanged": "PREPARED_NOT_AUTHORIZED",
  "db_provenance": {
    "status": "READY",
    "required_series_present": true,
    "auditor_recompute_pass": true,
    "common_interval_proven": true
  },
  "live_window_authorized": false
}
```

Other verdicts include: `DB_PROVENANCE_NOT_READY`, `QUERY_PLANE_PIN_INCOMPLETE`, `DOCKER_PLANE_MISMATCH`, `RUNTIME_PIN_INCOMPLETE`, `OBSERVABILITY_DENOMINATOR_INCOMPLETE`, `CLUSTER_MUTATION_DETECTED`, `PACKET_STATUS_TAMPER_ATTEMPT`.

## Packet pin completion

Only `READ_ONLY_LIVE_PROBE_PASS` may fill placeholders:

```text
expected_runtime_sha
query_plane_pin.leaf_sha256
query_plane_pin.intermediate_sha256
query_plane_pin.root_sha256
Docker execution-plane pin
observability expected pod denominators
```

Packet remains:

```text
status = PREPARED_NOT_AUTHORIZED
live_window_authorized = false
live_capture_acceptance_ready = false
live_capture_armed_for_window = false
```

## Tests

- Probe under PREPARED packet never calls publisher tick.
- Missing Ticket 1 series → `DB_PROVENANCE_NOT_READY`.
- Mutation / throughput change attempts → fail closed.
- PASS path updates placeholders without flipping authorization flags.
