---
name: Runtime Heartbeat Ticket 06
about: Three-broker Kafka mTLS and failover
title: "[runtime-heartbeat] Ticket 06 — Three-broker Kafka mTLS and failover"
labels: ["runtime-heartbeat", "pre-performance-gate"]
---

## Dependencies

Depends on Tickets: **5** (must be PASS before starting).



## Acceptance

See directive Ticket 06 acceptance counters. Status must be PASS or BLOCKED — never PARTIAL PASS.

## Evidence root

`/tmp/record-platform-runtime-heartbeat-v1/`

## Checklist

- [ ] Preconditions satisfied
- [ ] Live evidence captured (not static greps)
- [ ] Reports written under `reports/`
- [ ] Ledger JSONL appended
- [ ] No TLS bypasses
