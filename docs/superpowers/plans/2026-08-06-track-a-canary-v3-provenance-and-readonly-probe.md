# Track A — Canary-v3 DB Provenance + Read-Only Probe Implementation Plan

> **Superseded for coding gates by:** [`2026-08-06-track-a-file-level-implementation.md`](./2026-08-06-track-a-file-level-implementation.md)  
> **CI DAG:** [`2026-08-06-tracks-a-g-ci-dependency-dag.md`](./2026-08-06-tracks-a-g-ci-dependency-dag.md)

This file remains as an orientation stub. Use the file-level plan for exact source files, tests, artifacts, and completion gates.

---

# Track A — Orientation Stub (do not implement from this file)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Ticket 1 (evidence-bound DB-term provenance) and Ticket 2 (PREPARED read-only probe) as harness code with CI tests; never authorize or execute the live one-hour window.

**Architecture:** Extend `auction_monitor_canary_v3_live_capture.py` and `audit-auction-monitor-canary-v3-final-root.py` for hashed provenance; add four monotonic counters in auction-monitor; add probe runner gated on provenance readiness.

**Tech Stack:** Python 3, Node test runner (`node --test`), Prometheus client counters, existing production adapters.

## Global Constraints

- `execution_authorized=false`; do not flip `LIVE_CAPTURE_ACCEPTANCE_READY`
- Packet remains `PREPARED_NOT_AUTHORIZED`
- No publisher throughput change; no historical outbox mutation; no window arm
- Approach B: counters + schema + auditor + tampers atomic for Ticket 1
- Ticket 2 cannot emit `READ_ONLY_LIVE_PROBE_PASS` until Ticket 1 validates
- Specs: `docs/superpowers/specs/2026-08-06-canary-v3-db-term-provenance-design.md`, `...-readonly-live-probe-design.md`

---

### Task 1: Four monotonic counters

**Files:**
- Modify: auction-monitor metrics module (locate existing `auction_monitor_outbox_*_total` registrations)
- Create/Modify: increment sites at insert / DB-ack / reopen / delete-unpublished transitions
- Test: unit test that series names match exact contract strings

**Interfaces:**
- Produces: `auction_monitor_outbox_created_total`, `auction_monitor_outbox_db_acknowledged_total`, `auction_monitor_outbox_reopened_total`, `auction_monitor_outbox_deleted_unpublished_total`

- [ ] **Step 1:** Grep existing outbox counters; write failing test asserting the four new series exist in registry export text
- [ ] **Step 2:** Register counters (no labels or fixed `result="ok"` only)
- [ ] **Step 3:** Increment at true transitions only
- [ ] **Step 4:** Run unit test; pass
- [ ] **Step 5:** Commit when user requests

---

### Task 2: Provenance writers + equation v2

**Files:**
- Modify: `scripts/lib/auction_monitor_canary_v3_live_capture.py`
- Modify: fixture equation in `scripts/lib/auction_monitor_canary_v3_orchestrator.py`
- Test: `tests/auction-monitor-canary-v3-db-provenance.test.mjs` (new)

**Interfaces:**
- Produces: `db-provenance/**` layout + `canary-v3-database-equation-terms/v2`
- Mandatory fields: `test_run_id`, `source_sha`, `runtime_sha`, `pod_uid_t0/t1`, `process_start_time_t0/t1`, `counter_epoch_unchanged`, `writer_count`

- [ ] **Step 1:** Write failing tests for missing series / reset / label drift / epoch change
- [ ] **Step 2:** Implement scrape freeze + term objects + summary v2
- [ ] **Step 3:** Reject column-absence and circular sources
- [ ] **Step 4:** Green tests
- [ ] **Step 5:** Commit when user requests

---

### Task 3: Auditor recomputation

**Files:**
- Modify: `scripts/audit-auction-monitor-canary-v3-final-root.py`
- Test: extend `tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs`

**Interfaces:**
- Consumes: `db-provenance/` artifacts
- Produces: fail codes from provenance design

- [ ] **Step 1:** Failing tests for hash mismatch and summary≠recompute
- [ ] **Step 2:** Auditor reads artifacts, recomputes, verifies equation
- [ ] **Step 3:** Green + regenerate PREPARED packet adapter hashes
- [ ] **Step 4:** Commit when user requests

---

### Task 4: Read-only probe runner

**Files:**
- Create: `scripts/run-auction-monitor-canary-v3-readonly-live-probe.py`
- Modify: `scripts/lib/auction_monitor_canary_v3_production_adapters.py` if needed
- Test: `tests/auction-monitor-canary-v3-readonly-probe.test.mjs` (new)

**Interfaces:**
- Consumes: PREPARED packet; Ticket 1 validation
- Produces: `reports/outbox/canary-v3-live-readonly-probe.json` (+ `.sha256`)
- Verdicts: `DB_PROVENANCE_NOT_READY` | `READ_ONLY_LIVE_PROBE_PASS` | other fail-closed

- [ ] **Step 1:** Test: missing counters → `DB_PROVENANCE_NOT_READY`; no publisher tick
- [ ] **Step 2:** Implement runner with allowlist-only observation
- [ ] **Step 3:** PASS path may fill placeholders without authorizing
- [ ] **Step 4:** Do **not** run against live cluster in CI unless a mocked plane is provided; live probe remains manual/later
- [ ] **Step 5:** Commit when user requests

---

### Task 5: Gate check (no acceptance flip)

- [ ] Confirm flags still false in runner constants and PREPARED packet
- [ ] Confirm harness + fail-closed + adversarial + tamper + new provenance/probe tests green
- [ ] Stop. Do not request owner authorization in this track.
