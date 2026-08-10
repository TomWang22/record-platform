# Track C — All-Outbox Inventory and Lifecycle Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete outbox owner inventory and a lifecycle evidence harness that does not treat auction-monitor canary-v3 as platform-wide outbox PASS.

**Architecture:** Static + schema-derived inventory JSON; lifecycle recorder with frozen identity fields; independent auditor stubs.

**Tech Stack:** Node/Python, SQL introspection, existing outbox SQL under `infra/db/`.

## Global Constraints

- `execution_authorized=false`
- Spec: `2026-08-06-all-service-outbox-acceptance-design.md`
- Media `publisher_present=false` must be explicit disposition, not silent ack

---

### Task 1: Inventory builder

**Files:**
- Create: `scripts/performance/build-outbox-inventory.mjs`
- Create: `reports/performance/outbox-owner-inventory.PREPARED.json`
- Test: `tests/outbox-owner-inventory.test.mjs`

- [ ] **Step 1:** Grep `infra/db/*outbox*` and service publishers; draft inventory rows
- [ ] **Step 2:** Schema validation test
- [ ] **Step 3:** Fail if any row lacks `publisher_owner` or `database`
- [ ] **Step 4:** Commit when user requests

---

### Task 2: Lifecycle evidence schema + recorder stub

**Files:**
- Create: `scripts/lib/outbox_lifecycle_evidence.py` (or `.mjs`)
- Test: latency bucket + unknown=0 rules

- [ ] **Step 1:** Define frozen identity JSON schema
- [ ] **Step 2:** Recorder API that refuses SUCCESS without all lifecycle states
- [ ] **Step 3:** Unit tests for failure/recovery row classifications
- [ ] **Step 4:** Commit when user requests

---

### Task 3: Independent outbox auditor stub

- [ ] Auditor reads frozen evidence only; exit ≠ 0 on missing consumer effect
- [ ] No live publish in this track
- [ ] Commit when user requests
