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

## Hard stops

- Production enablement: NOT APPROVED
- No /tmp evidence committed
- No H1-only replay
- No remediation (32H-D) until R1 confirms cause A–E
