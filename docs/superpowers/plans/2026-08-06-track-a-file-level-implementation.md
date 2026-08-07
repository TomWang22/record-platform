# Track A — File-Level Implementation Plan (Counters → Capture → Auditor → Tamper → Probe)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land A1 (provenance) atomically, then A2 (PREPARED read-only probe) fail-closed on A1, with exact files, tests, CI jobs, artifacts, and completion gates. Never authorize or execute canary-v3.

**Architecture:** Four new transition counters in auction-monitor → live-capture freezes raw Prometheus T0/T1 + term provenance → final-root auditor recomputes from artifacts → tamper suite → probe runner emits `DB_PROVENANCE_NOT_READY` until A1 validates.

**Tech Stack:** TypeScript (`prom-client`), Python 3 harness/auditor, `node --test`, vitest for service unit tests.

**Specs:**
- `docs/superpowers/specs/2026-08-06-canary-v3-db-term-provenance-design.md`
- `docs/superpowers/specs/2026-08-06-canary-v3-readonly-live-probe-design.md`
- Parent: `docs/superpowers/specs/2026-08-06-record-platform-performance-and-lineage-master-design.md`

## Global Constraints

```text
execution_authorized = false
LIVE_CAPTURE_ACCEPTANCE_READY = false
LIVE_CAPTURE_ARMED_FOR_WINDOW = false
CANARY_V3_EXECUTION_AUTHORIZED = false
CANARY_V3_WINDOW_EXECUTED = false
packet.status = PREPARED_NOT_AUTHORIZED
```

- No alias of `auction_monitor_outbox_db_ack_total` → acceptance uses `auction_monitor_outbox_db_acknowledged_total` only.
- No zero inferred from missing columns/counters.
- No live one-hour window; no throughput change; no historical outbox mutation.
- Do not clear host caches or mutate Gate5/Gate6 artifacts.

## File map (touch list)

| Role | Path |
| --- | --- |
| Counter registry | `services/auction-monitor/src/outbox-publish-metrics.ts` |
| Insert / publish transitions | `services/auction-monitor/src/ai-signals.ts` |
| Accounting helpers (if needed) | `services/auction-monitor/src/outbox-publish-accounting.ts` |
| Service unit tests | `services/auction-monitor/src/__tests__/outbox-publish-accounting.test.ts` |
| New metric unit tests | `services/auction-monitor/src/__tests__/outbox-provenance-counters.test.ts` |
| Live capture / provenance | `scripts/lib/auction_monitor_canary_v3_live_capture.py` |
| Orchestrator fixture equation | `scripts/lib/auction_monitor_canary_v3_orchestrator.py` |
| Production adapters / probe hooks | `scripts/lib/auction_monitor_canary_v3_production_adapters.py` |
| Final-root auditor | `scripts/audit-auction-monitor-canary-v3-final-root.py` |
| Runner constants / refuse live | `scripts/run-auction-monitor-broker-ack-canary-v3.py` |
| New probe runner | `scripts/run-auction-monitor-canary-v3-readonly-live-probe.py` |
| PREPARED packet | `reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json` (+ `.sha256`) |
| Harness status report | `reports/outbox/auction-monitor-canary-v3-harness-implementation.json` |
| Existing fail-closed tests | `tests/auction-monitor-canary-v3-live-capture-fail-closed.test.mjs` |
| Existing adversarial tests | `tests/auction-monitor-canary-v3-live-capture-adversarial.test.mjs` |
| Existing frozen-root tamper | `tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs` |
| Existing harness tests | `tests/auction-monitor-canary-v3-harness.test.mjs` |
| New provenance tests | `tests/auction-monitor-canary-v3-db-provenance.test.mjs` |
| New probe tests | `tests/auction-monitor-canary-v3-readonly-probe.test.mjs` |
| CI workflow | `.github/workflows/ci.yml` **and/or** new `.github/workflows/performance-harness.yml` |

## Counter contract (exact)

| Series | Increment site |
| --- | --- |
| `auction_monitor_outbox_created_total` | After successful `INSERT INTO auction_monitor.outbox_events` (`ai-signals.ts`) |
| `auction_monitor_outbox_db_acknowledged_total` | After successful `UPDATE … SET published = true` with rowCount validation (alongside existing `db_ack_total`, not as an alias rename for acceptance) |
| `auction_monitor_outbox_reopened_total` | Only at real unpublished→reopened transition; if no transition code exists yet, register counter and leave at 0 (series must still export) |
| `auction_monitor_outbox_deleted_unpublished_total` | Only at real unpublished delete; same rule as reopened |

Labels: none preferred; if labels required for registry consistency with siblings, only `result` with values `ok` (and never high-cardinality IDs).

---

### Task 1: Counters (A1.1)

**Files:**
- Modify: `services/auction-monitor/src/outbox-publish-metrics.ts`
- Modify: `services/auction-monitor/src/ai-signals.ts` (insert + DB ack sites)
- Create: `services/auction-monitor/src/__tests__/outbox-provenance-counters.test.ts`
- Modify: `listOutboxMetricNames()` to include the four new names

**Produces:** four registered monotonic counters exportable via Prometheus registry text.

- [ ] **Step 1: Write failing vitest** asserting registry text / `listOutboxMetricNames()` contains exactly the four contract names (and still retains legacy `db_ack_total`).

```ts
expect(listOutboxMetricNames()).toEqual(
  expect.arrayContaining([
    "auction_monitor_outbox_created_total",
    "auction_monitor_outbox_db_acknowledged_total",
    "auction_monitor_outbox_reopened_total",
    "auction_monitor_outbox_deleted_unpublished_total",
    "auction_monitor_outbox_db_ack_total", // legacy; not acceptance alias
  ]),
);
```

- [ ] **Step 2: Run** `pnpm --filter auction-monitor test -- outbox-provenance-counters` — expect FAIL (names missing).
- [ ] **Step 3: Register counters + `incOutboxCreated` / `incOutboxDbAcknowledged` / `incOutboxReopened` / `incOutboxDeletedUnpublished`.**
- [ ] **Step 4: Wire increments** at insert and DB-ack success in `ai-signals.ts`. Do not increment reopened/deleted without a real transition.
- [ ] **Step 5: Re-run vitest** — expect PASS.
- [ ] **Step 6: Commit** only when user requests.

**Completion gate:** four series present in export; no column-absence path; legacy `db_ack_total` unchanged for v2 tooling.

---

### Task 2: Capture — raw T0/T1 + provenance objects (A1.2)

**Files:**
- Modify: `scripts/lib/auction_monitor_canary_v3_live_capture.py`
  - Add: scrape freeze helpers, `db-provenance/` writers, epoch fields
  - Change: `compute_database_equation_terms` / session methods to emit schema `canary-v3-database-equation-terms/v2`
- Modify: `scripts/lib/auction_monitor_canary_v3_orchestrator.py` fixture to emit full `db-provenance/` tree for dry-run
- Create: `tests/auction-monitor-canary-v3-db-provenance.test.mjs`

**Artifact layout under canary root:**

```text
database-equation-terms.json
db-provenance/interval.json
db-provenance/metrics/t0.prom.txt
db-provenance/metrics/t0.meta.json
db-provenance/metrics/t1.prom.txt
db-provenance/metrics/t1.meta.json
db-provenance/terms/{created_unpublished,database_acknowledged,reopened,deleted_unpublished,pending_delta}.json
db-provenance/snapshots/db-t0.json
db-provenance/snapshots/db-t1.json
```

**Mandatory fields on interval + scrape metas + term objects:**

```text
test_run_id, source_sha, runtime_sha,
pod_uid_t0, pod_uid_t1,
process_start_time_t0, process_start_time_t1,
counter_epoch_unchanged, writer_count
```

- [ ] **Step 1: Failing node tests** for:
  - missing series → error
  - `T1 < T0` → counter reset
  - label-set drift
  - `pod_uid_t0 != pod_uid_t1` / process_start_time drift / `counter_epoch_unchanged=false`
  - summary value ≠ recomputed delta (capture-side validation)
- [ ] **Step 2: Run** `node --test tests/auction-monitor-canary-v3-db-provenance.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement writers + parsers** (raw body SHA-256; no fabricated zeros).
- [ ] **Step 4: Update dry-run fixture** so orchestrator still reaches `CANARY_DONE` with provenance present.
- [ ] **Step 5: Re-run provenance + harness tests** — expect PASS.
- [ ] **Step 6: Commit** when user requests.

**Completion gate:** dry-run root contains complete `db-provenance/`; equation v2; epoch binding enforced.

---

### Task 3: Provenance auditor recomputation (A1.3)

**Files:**
- Modify: `scripts/audit-auction-monitor-canary-v3-final-root.py`
- Modify: `tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs` (add provenance cases)
- Modify: any auditor fixture builders used by `tests/auction-monitor-canary-v3-harness.test.mjs`

**Auditor must:**

1. Require equation schema v2 + `provenance_root`
2. Read each referenced artifact; verify SHA-256
3. Recompute four counter deltas + `pending_delta`
4. Verify common interval; reject overlapping/circular/column-absence
5. Reject epoch/pod/process drift
6. Reject missing zero-term evidence
7. Recompute final equation identity

- [ ] **Step 1: Failing tests** — mutate `t1.prom.txt` byte / drop series / change summary only → auditor FAIL; pristine PASS.
- [ ] **Step 2: Implement recomputation** in auditor (do not trust summary numbers alone).
- [ ] **Step 3: Run** harness + tamper + provenance tests — PASS.
- [ ] **Step 4: Regenerate** PREPARED packet adapter hashes via `write_prepared_live_window_authorization_packet` (status stays `PREPARED_NOT_AUTHORIZED`).
- [ ] **Step 5: Commit** when user requests.

**Completion gate:** A1 atomic unit green; `LIVE_CAPTURE_ACCEPTANCE_READY` still false.

**CI artifact (job `perf-track-a1-provenance`):**

```text
reports/ci/track-a1-provenance-result.json
```

```json
{
  "track": "A1",
  "verdict": "HARNESS_PASS",
  "execution_authorized": false,
  "counters_registered": true,
  "auditor_recompute_tests_pass": true,
  "tamper_tests_pass": true,
  "acceptance_ready": false
}
```

---

### Task 4: Tamper suite expansion (A1.4)

**Files:**
- Modify: `tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs`
- Optionally create: `tests/auction-monitor-canary-v3-db-provenance-tamper.test.mjs` if file size warrants split

**Required mutate→FAIL cases:**

```text
missing series
counter reset
label-set drift
interval mismatch
negative delta (summary only)
artifact hash mismatch
summary != recomputed delta
column-absence proof
missing zero-term evidence file
pod_uid change
process_start_time change
counter_epoch_unchanged=false
```

Source root must remain PASS/`CANARY_DONE` after clone mutations.

- [ ] **Step 1: Add cases** (failing until auditor/capture enforce them).
- [ ] **Step 2: Green suite.**
- [ ] **Step 3: Commit** when user requests.

**Completion gate:** every listed tamper fails auditor; A1 considered complete only with Tasks 1–4 green together (Approach B).

---

### Task 5: PREPARED read-only live probe (A2)

**Files:**
- Create: `scripts/run-auction-monitor-canary-v3-readonly-live-probe.py`
- Modify: `scripts/lib/auction_monitor_canary_v3_production_adapters.py` (readonly probe gates already exist; extend for provenance readiness check)
- Create: `tests/auction-monitor-canary-v3-readonly-probe.test.mjs`
- Outputs (when run): `reports/outbox/canary-v3-live-readonly-probe.json` + `.sha256`

**Allowed:** runtime pin, Docker/PG plane, Jaeger TLS three-stage, Kafka leaders, DB T0, counter presence, log cursor, observability denominators.

**Forbidden:** publisher tick, one-hour equation claim, throughput change, outbox writes, window start, packet authorization.

**Verdicts:**

```text
DB_PROVENANCE_NOT_READY     # default until A1 validates
READ_ONLY_LIVE_PROBE_PASS   # only after A1 + observation complete
```

Even PASS must leave:

```text
live_window_authorized = false
LIVE_CAPTURE_ARMED_FOR_WINDOW = false
CANARY_V3_EXECUTION_AUTHORIZED = false
packet.status = PREPARED_NOT_AUTHORIZED
```

- [ ] **Step 1: Failing tests** — missing counters → `DB_PROVENANCE_NOT_READY`; publisher tick never called; PASS path does not flip auth flags.
- [ ] **Step 2: Implement runner** with mocked command runner in CI (no live cluster required for harness job).
- [ ] **Step 3: Optional live job** remains `if: false` / manual workflow_dispatch only; default CI uses fixtures.
- [ ] **Step 4: Green probe tests.**
- [ ] **Step 5: Commit** when user requests.

**CI artifact (job `perf-track-a2-readonly-probe`):**

```text
reports/ci/track-a2-readonly-probe-result.json
```

```json
{
  "track": "A2",
  "verdict": "DB_PROVENANCE_NOT_READY | HARNESS_PASS",
  "depends_on": ["A1"],
  "read_only_live_probe_pass": false,
  "live_window_authorized": false,
  "execution_authorized": false
}
```

When A1 harness PASS and fixture provenance validates, CI may set `"verdict": "HARNESS_PASS"` for the **mocked** probe path without claiming cluster `READ_ONLY_LIVE_PROBE_PASS`.

**Live probe artifact (manual / future):**

```text
reports/outbox/canary-v3-live-readonly-probe.json
reports/outbox/canary-v3-live-readonly-probe.sha256
```

---

### Task 6: CI wiring for Track A

**Files:**
- Create or extend: `.github/workflows/performance-harness.yml` (preferred over overloading monolithic `ci.yml`)
- Jobs: `perf-track-a1-provenance`, `perf-track-a2-readonly-probe` (needs A1)

- [ ] **Step 1: Add workflow** with `execution_authorized: false` env; never dispatch canary window.
- [ ] **Step 2: A1 job commands:**

```bash
pnpm --filter auction-monitor test -- outbox-provenance-counters outbox-publish-accounting
node --test \
  tests/auction-monitor-canary-v3-db-provenance.test.mjs \
  tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs \
  tests/auction-monitor-canary-v3-live-capture-fail-closed.test.mjs \
  tests/auction-monitor-canary-v3-live-capture-adversarial.test.mjs \
  tests/auction-monitor-canary-v3-harness.test.mjs
```

- [ ] **Step 3: A2 job** `needs: [perf-track-a1-provenance]`; run probe tests only.
- [ ] **Step 4: Upload artifacts** listed above; fail job if any acceptance flag true in JSON.
- [ ] **Step 5: Commit** when user requests.

---

## Track A completion matrix

| Gate | Condition |
| --- | --- |
| A1 complete | Tasks 1–4 green; CI artifact `HARNESS_PASS`; counters real; auditor recomputes; tampers fail closed |
| A2 harness complete | Probe tests green; missing A1 → `DB_PROVENANCE_NOT_READY` |
| A2 live PASS | Manual only after A1 live counters exported; emits `READ_ONLY_LIVE_PROBE_PASS`; pins filled; auth flags still false |
| A3 | **Out of this plan** — separate owner AUTHORIZED packet |

## Explicitly not in Track A

- Finite-drain, quiesce-v2, Gate5-AB, Gate5-v10, Gate 6
- Flipping `LIVE_CAPTURE_ACCEPTANCE_READY` without owner review after A2 live PASS
- Platform Tracks B–G execution
