# Track A Owner-Review Checklist

**Date:** 2026-08-06  
**Scope:** Canary-v3 DB provenance (A1) + hardened PREPARED read-only probe (A2)  
**execution_authorized:** false

This checklist is the gate between **coding complete** and any future acceptance flag change. Completing it does **not** authorize the one-hour canary-v3 window.

---

## 0. Preconditions

- [ ] Exact-SHA CI green for the frozen Track A commit (`performance-harness-track-a` or `node scripts/ci/run-track-a-exact-sha-ci.mjs`)
- [ ] `reports/ci/track-a-meta-auditor-result.json` verdict = `TRACK_A_META_PASS`
- [ ] Meta-auditor `exact_sha` equals `git rev-parse HEAD`
- [ ] `git rev-parse HEAD` equals `git rev-parse origin/main`
- [ ] Owner preflight PASS: `node scripts/ci/verify-track-a-owner-preflight.mjs`
- [ ] Track A sources are **committed and clean** at that SHA (preflight fails on untracked/dirty sources even when the SHA triple matches)
- [ ] PREPARED packet still `status = PREPARED_NOT_AUTHORIZED`
- [ ] All of the following remain **false** in CI + packet:

```text
LIVE_CAPTURE_ACCEPTANCE_READY
A2_LIVE_ACCEPTANCE_READY
live_window_authorized
CANARY_V3_EXECUTION_AUTHORIZED
CANARY_V3_WINDOW_EXECUTED
finite_drain_experiment_armed
maintenance_quiesce_v2_created
gate5_ab_started
gate5_v10_created
gate6_authorized
production_approved
execution_authorized
```

---

## 1. Contract review (desk)

- [ ] Confirm hardened PASS contract requires T0/T1 hashed scrapes, independent recomputation, and strict observation planes
- [ ] Confirm fail-closed verdicts: `DB_PROVENANCE_NOT_READY`, `LIVE_PROBE_OBSERVATIONS_INCOMPLETE`, `PACKET_STATUS_TAMPER_ATTEMPT`
- [ ] Confirm CI harness must keep `read_only_live_probe_pass = false`
- [ ] Confirm adapter `adapter_source_hashes` in PREPARED packet match meta-auditor recomputation
- [ ] Confirm throughput pin remains `batch=25`, `interval_seconds=120`, `invocations=30`

---

## 2. Artifact inventory before manual probe

Record the following into the owner archive note:

| Item | Path / value |
| --- | --- |
| Exact source SHA | `git rev-parse HEAD` |
| Denom freeze | `reports/ci/denom-freeze.json` (+ `.sha256`) |
| A1 result | `reports/ci/track-a1-provenance-result.json` (+ `.sha256`) |
| A2 result | `reports/ci/track-a2-readonly-probe-result.json` (+ `.sha256`) |
| Exact-SHA bundle | `reports/ci/track-a-exact-sha-bundle.json` (+ `.sha256`) |
| Meta-auditor | `reports/ci/track-a-meta-auditor-result.json` (+ `.sha256`) |
| PREPARED packet | `reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json` (+ `.sha256`) |
| Command packet | `reports/outbox/canary-v3-manual-readonly-probe-command-packet.PREPARED.json` |

- [ ] Byte-freeze PREPARED packet SHA-256 before the manual probe
- [ ] Confirm no `AUTHORIZED` packet exists for canary-v3

---

## 3. Manual read-only probe (owner-attended)

Use **only** the command packet in:

```text
reports/outbox/canary-v3-manual-readonly-probe-command-packet.PREPARED.json
```

- [ ] Cluster is the intended Colima/k3d plane; MetalLB Jaeger pin unchanged
- [ ] Publisher throughput unchanged (25 / 120s / 30)
- [ ] Run the exact argv from the command packet (no extra flags)
- [ ] Confirm process exit and report `verdict`
- [ ] Re-read PREPARED packet bytes; require **exact equality** to pre-probe freeze
- [ ] Archive:

```text
reports/outbox/canary-v3-live-readonly-probe.json
reports/outbox/canary-v3-live-readonly-probe.json.sha256
reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json
reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json.sha256
command transcript (stdout/stderr)
exact source SHA + auction-monitor runtime SHA / image digest / pod UID
```

---

## 4. Independent audit of the live probe artifact

Run:

```bash
python3 scripts/audit-canary-v3-live-readonly-probe-archive.py \
  --probe reports/outbox/canary-v3-live-readonly-probe.json \
  --probed-packet reports/outbox/canary-v3-live-window-authorization-packet.PROBED.json \
  --prepared-packet reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json \
  --prepared-sha-before "$PREPARED_SHA_BEFORE"
```

- [ ] Archive auditor verdict = `LIVE_PROBE_ARCHIVE_AUDIT_PASS`
- [ ] `verdict` is either fail-closed **or** `READ_ONLY_LIVE_PROBE_PASS`
- [ ] If PASS: `db_provenance.auditor_recompute_pass = true`
- [ ] If PASS: `db_provenance.common_interval_proven = true`
- [ ] If PASS: `db_provenance.counter_epoch_unchanged = true`
- [ ] `cluster_mutation_attempted = false`
- [ ] `publisher_invocation_triggered = false`
- [ ] `outbox_rows_mutated = 0`
- [ ] `throughput_changed = false`
- [ ] `packet_status_unchanged = PREPARED_NOT_AUTHORIZED`
- [ ] `live_window_authorized = false`
- [ ] `execution_authorized = false`
- [ ] `live_capture_acceptance_ready = false`
- [ ] `live_capture_armed_for_window = false`
- [ ] `a2_live_acceptance_ready = false` (if present)
- [ ] PROBED copy remains `PREPARED_NOT_AUTHORIZED` (never `AUTHORIZED`)

A live `READ_ONLY_LIVE_PROBE_PASS` still does **not** flip acceptance flags.

---

## 5. Explicit non-goals (do not do)

- [ ] Do **not** create an `AUTHORIZED` canary-v3 execution packet in this review
- [ ] Do **not** run `publisher_tick`, canary window, root lease, or `CANARY_DONE`
- [ ] Do **not** mutate historical outbox rows or change throughput
- [ ] Do **not** arm finite-drain / quiesce-v2 / Gate5-AB / Gate5-v10 / Gate6

---

## 6. Sign-off

| Role | Name | Date | Decision |
| --- | --- | --- | --- |
| Owner |  |  | coding gate accepted / probe deferred / probe archived |
| Independent reviewer |  |  | live probe artifact audited / rejected |

**Next separate owner action (not this checklist):** create an `AUTHORIZED` canary-v3 execution packet only after archived live probe evidence and explicit authorization.
