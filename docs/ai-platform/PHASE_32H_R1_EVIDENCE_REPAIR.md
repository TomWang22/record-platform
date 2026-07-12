# Phase 32H-R1 — Evidence Repair

```text
Status: IN PROGRESS
Prior E3 run: BLOCKED (frozen)
Production enablement: NOT APPROVED
```

## Objective

Repair matrix and collector integrity failures that invalidated the Phase 32H-E3 run, then execute a fresh three-protocol host-suspension A/B validation.

## E3 failures addressed

1. **Overlapping launch/resume** — 35 duplicate H1 probe IDs from concurrent runners without atomic locks.
2. **HEAD drift** — 20 rows written before infrastructure HEAD was pinned.
3. **Collector death without arm abort** — PCAP died ~4h without blocking the matrix.
4. **No run_id** — rows could not be attributed to a single launch generation.

## Repairs implemented

### Run integrity (`scripts/lib/phase32h-run-integrity.mjs`)

- Atomic root-level execution lease under `run-state/`
- Per-protocol shard locks (`h1.lock`, `h2.lock`, `h3.lock`)
- Probe index with duplicate `probe_id` and coordinate rejection before append
- Canonical coordinate key: `protocol|window|user_class|user_hash|run|case_id`
- Launch HEAD pinning; runner abort on HEAD or manifest SHA change
- Truncated JSONL detection before resume
- `COLLECTOR_COVERAGE_BLOCKED` marker on mandatory collector failure

### Collector supervision (`scripts/lib/phase32h-collector-supervision.mjs`)

- Independent 1s supervisor (`scripts/phase32h-collector-supervisor.mjs`)
- Mandatory collectors: PCAP, watchdog, gateway logs, application logs, host telemetry, power telemetry, H1/H2/H3 heartbeats, matrix monitor
- Freshness gates per role; arm BLOCKED after 10s unhealthy mandatory collector
- PCAP gap cannot be reported as PASS coverage

### Freeze (`scripts/phase32h-freeze-blocked-run.mjs`)

- Stops post-run collectors cleanly
- Hashes all blocked-root evidence without modifying JSONL
- Writes blocked-run manifest and integrity artifacts

## Verifiers

```bash
make ai-platform-verify-phase32h-run-integrity
make ai-platform-verify-phase32h-collector-supervision
make ai-platform-verify-phase32h-infra
make ai-platform-freeze-phase32h-blocked-run   # operator; frozen root only
```

## Evidence roots

| Arm | Root | Label |
| --- | ---- | ----- |
| Baseline (normal power) | `/tmp/phase32h-r1-baseline` | Phase 32H-R1 baseline synchronized-stall validation |
| Protected (caffeinate) | `/tmp/phase32h-r1-caffeinate` | Phase 32H-R1 caffeinate synchronized-stall validation |

Never reuse `/tmp/phase32h-targeted-reproduction`.

## Launch

```bash
# Do not launch until transport forensics + QUIC lifecycle smoke PASS.
make ai-platform-verify-phase32h-transport-forensics
make ai-platform-verify-phase32h-quic-lifecycle
make ai-platform-verify-phase32h-quic-lifecycle-smoke

node scripts/phase32h-launch-r1-arm.mjs --arm baseline
node scripts/phase32h-launch-r1-arm.mjs --arm caffeinate
```

### Capture design

- **One continuous ring-buffer PCAP per arm** (not per probe)
- **Per-probe packet index** under `probe-packet-index/<probe_id>.json`
- **Synchronized H1/H2/H3 triplet batches** with <=100ms start spread gate
- **QUIC lifecycle mini-matrix** (cold/warm/resumed/0-RTT) separate from 8,640 application probes
- Safe 0-RTT testing uses `GET/HEAD /api/ai/rag/transport-probe` only — never RAG POST as early data

Both arms: 8,640 probes (2,880 per protocol), H1/H2/H3 together.

### Canary (baseline-r2)

- **90-probe canary** at `/tmp/phase32h-r1-baseline-r2-canary` — **FROZEN BLOCKED** (3/90, HTTP 422)
- **90-probe canary-v2** at `/tmp/phase32h-r1-baseline-r2-canary-v2` — **FROZEN PASS** (90/90 functional)
  - Batch correlation: **30/30 PASS**
  - Per-probe packet indexes: **not available** (historical pre-repair triplet path; 0/90)
  - Baseline launch requires repaired per-probe indexing (**8,640/8,640**)
- First blocked root used **partial source provenance** (uncommitted canary launcher at reported HEAD `92be1a6b`)
- Never resume frozen roots; use `-v2` suffix for reruns after repair
- Launch: `node scripts/phase32h-launch-r1-arm.mjs --arm baseline --canary --out /tmp/phase32h-r1-baseline-r2-canary-v2`

### Baseline prelaunch hardening (r2)

- **ESM closeout**: committed `.mjs` CLIs replace fragile `node -e` ESM eval; launch package via `scripts/phase32h-launch-package-readonly.mjs`
- **Freeze integrity**: `scripts/lib/phase32h-freeze-integrity.mjs` quiesces writers, quiet-period verification, hash manifest, frozen marker last
- **baseline-r2 historical addendum**: `phase32h-r1-baseline-r2-freeze-integrity-addendum.json` (monitor.log post-freeze mismatch; JSONL intact; not repaired)
- **Per-probe packet indexes**: triplet path writes `probe-packet-index/<probe_id>.json` after each batch
- **Disk gate**: hard minimum **40 GB** free; preferred **50 GB**; worst-case footprint ~27 GB evidence+PCAP

```bash
make ai-platform-verify-phase32h-baseline-preflight
```

Proposed baseline root: `/tmp/phase32h-r1-baseline-r5` (must not exist before launch)

**baseline-r4** (`/tmp/phase32h-r1-baseline-r4`) is **FROZEN BLOCKED** — `FOREIGN_PCAP_COLLECTOR_PRELAUNCH_CONTAMINATION` (24/8640 probes; immutable `COLLECTOR_COVERAGE_BLOCKED`; never resume). Launch HEAD `62902092`.

**baseline-r3** (`/tmp/phase32h-r1-baseline-r3`) is **FROZEN BLOCKED** — `CORRELATION_BACKLOG_DRAIN_DEFECT` (153/8640 probes; correlation jobs enqueued but never drained; never resume). Launch HEAD `b53ab6af`.

**baseline-r2** (`/tmp/phase32h-r1-baseline-r2`) is **FROZEN BLOCKED** — `PRELAUNCH_POLICY_VIOLATION` (CI non-terminal at launch + disk reserve below 10 GB). Never resume.

### Correlation queue repair (post-r3)

- Durable queue: `run-state/correlation-queue.json` with `PENDING` / `RUNNING` / `COMPLETE` / `FAILED`
- Backlog counts only unresolved jobs (`PENDING` + `RUNNING`); `COMPLETE` does not block launch
- `finalizeTripletCorrelationJob` runs after per-probe and batch packet indexes are written
- Drain smoke target: 60 triplet batches / 180 probes at `/tmp/phase32h-r1-correlation-drain-smoke-v1`

```bash
make ai-platform-verify-phase32h-correlation-queue
make ai-platform-verify-phase32h-collector-exclusivity
make ai-platform-verify-phase32h-smoke-cleanup
```

Smoke freeze order: `finalizeSmokeWithFreeze()` stops collectors before hashing; `FROZEN_PASS_EVIDENCE` is written last.

## Hard stops

- Production enablement: NOT APPROVED
- No /tmp evidence committed
- No H1-only replay
- No remediation (32H-D) until R1 confirms cause A–E
