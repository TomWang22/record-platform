# Phase 34 gauntlet finalization

## Queue vs protocol acceptance

`queue_complete` means synchronized H1/H2/H3 probes executed and evidence was recorded.
It does **not** imply product acceptance.

Terminal PASS requires:

- `queue_complete == expected logical sessions`
- `logical_sessions_pass == expected`
- `logical_sessions_fail == 0`
- `protocol_rows_pass == expected * 3`
- `protocol_rows_fail == 0`
- zero HTTP 422 / 429 / 5xx / HTTP 0 / curl failures
- zero material parity failures

## Bounded reports

Finalization writes only bounded artifacts under `reports/`:

- `final-summary.json` (hard max 5 MiB)
- `final-capability-metrics.json`
- `final-protocol-metrics.json`
- `final-failure-index.jsonl`
- `artifact-index.json`

Per-batch payloads and full matrix rows are never serialized into the freeze marker.

## Verifiers

```bash
make ai-platform-verify-phase34-gauntlet-finalization
make ai-platform-verify-phase34-live-gauntlet
```

Foreground progress uses bounded `PHASE34_CHECKPOINT ...` lines every 500 sessions or 10 minutes.
