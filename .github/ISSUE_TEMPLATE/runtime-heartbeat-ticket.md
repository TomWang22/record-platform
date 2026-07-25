---
name: Runtime Heartbeat Ticket
about: Fail-closed runtime heartbeat acceptance ticket
title: "[runtime-heartbeat] Ticket N — "
labels: ["runtime-heartbeat", "pre-performance-gate"]
---

## Ticket

- [ ] Ticket number: 
- [ ] Depends on: (list ticket numbers that must PASS first)
- [ ] Blocks: 

## Objective

<!-- One paragraph -->

## Acceptance checkboxes

- [ ] Exact SHA pinned and recorded
- [ ] Evidence written under `/tmp/record-platform-runtime-heartbeat-v1/`
- [ ] Repo reports updated (no private keys)
- [ ] Machine-readable JSON status is PASS or BLOCKED (never PARTIAL PASS)
- [ ] Failures freeze `FROZEN_BLOCKED_EVIDENCE` and stop later destructive stages

## Ticket-specific acceptance

<!-- Paste from directive -->

## Evidence paths

- 

## Notes

- Do not start Tickets 7–13 until Tickets 2–6 PASS.
- Do not start pgbench/k6/full Playwright/Phase 34 until Ticket 13 stop line.
- Production remains NOT APPROVED.
