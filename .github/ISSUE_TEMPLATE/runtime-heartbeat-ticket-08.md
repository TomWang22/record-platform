---
name: Runtime Heartbeat Ticket 08
about: Redis and Lua correctness
title: "[runtime-heartbeat] Ticket 08 — Redis and Lua correctness"
labels: ["runtime-heartbeat", "pre-performance-gate"]
---

## Dependencies

Depends on Tickets: **2,3,4,5,6** (must be PASS before starting).

**Hard gate:** Tickets 2–6 must PASS before this ticket.

## Acceptance

See directive Ticket 08 acceptance counters. Status must be PASS or BLOCKED — never PARTIAL PASS.

## Evidence root

`/tmp/record-platform-runtime-heartbeat-v1/`

## Checklist

- [ ] Preconditions satisfied
- [ ] Live evidence captured (not static greps)
- [ ] Reports written under `reports/`
- [ ] Ledger JSONL appended
- [ ] No TLS bypasses
