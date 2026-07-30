# RP Observability Integrity Spec v1

This document defines **contract-driven** trace validation for the Record Platform Tracker lab. Implementations live under `scripts/trace-validators/`. Preflight may invoke gates after Step 7 when `JAEGER_QUERY_BASE` is set and `PREFLIGHT_STEP7_OBSERVABILITY_GATES=1` (default in strict lab flows).

## 1. Scope

Invariants across:

- **Structural** trace graph (span parentage, roots, uniqueness)
- **Temporal** parent/child windows and optional Kafka async bounds
- **Cross-layer** (Kafka offsets, DB rows, packet correlation) — *optional gates; stubs emit `SKIPPED` until wired*

State-machine overview: `infra/observability/preflight-state-machine.json`.

## 2. Terminology

| Term | Meaning |
|------|---------|
| Trace | One `traceID` and its spans as returned by Jaeger `/api/traces` |
| Root span | Span with no `CHILD_OF` references |
| Gate | A validator that emits JSON and non-zero exit on failure |

## 3. Structural invariants (Span-Tree v1)

Implemented in `scripts/trace-validators/step7-strict-span-invariant.mjs`.

- **S1** Exactly one root span.
- **S3** Every non-root span’s `CHILD_OF` parent exists in the same trace.
- **S4** Unique `spanID` values within the trace.
- **S5** No parent-reference cycles.
- **S0** Span count floor (`STEP7_MIN_SPANS`, default 4).
- **S_depth** Max parent-chain depth ≥ `STEP7_MIN_DEPTH` (default 2).
- **S_services** Optional: `STEP7_REQUIRED_SERVICES` comma list — each must match a process `serviceName` (substring allowed).

## 4. Temporal invariants (Overlap v1)

Implemented in `scripts/trace-validators/trace-overlap-validator.mjs`.

- **O1** Parent containment: `parent.start ≤ child.start + ε` and `child.end ≤ parent.end + ε` (ε = 5µs default).
- **O3** Root envelope: root span covers `min(span.start)` and `max(span.end)` within `STEP7_ROOT_ENVELOPE_EPS_US` (default 50ms).
- **O4** Kafka async bound: if both `messaging.system=kafka` producer and consumer spans exist, some consumer starts after its produce end with gap ≤ 10s.

## 5. Cross-layer (optional)

| Gate | Script | Enable |
|------|--------|--------|
| Kafka offset | `kafka-offset-invariant.mjs` | `STEP7_REQUIRE_KAFKA_OFFSET=1` (stub) |
| DB row | `db-row-invariant.mjs` | `STEP7_REQUIRE_DB_ROW=1` (stub) |
| Packet ↔ trace | `packet-trace-correlation.mjs` | `STEP7_REQUIRE_PACKET_TRACE=1` (stub) |

## 6. Orchestration

`scripts/trace-validators/run-step7-observability-gates.mjs`:

- Reads `JAEGER_QUERY_BASE`, fetches traces for `STEP7_SEED_SERVICE` (default `api-gateway`).
- Retries `STEP7_RETRIES` (default 8) with `STEP7_SLEEP_MS` (default 2000).
- Writes `step7-observability-gates.json` under `--report-dir`.

Drift log: `node scripts/observability-drift-append.mjs --report-dir …` appends a line to `bench_logs/observability-history.jsonl`.

## 7. Failure semantics

On **FAIL**, preflight exits non-zero when `PREFLIGHT_STRICT_EXIT=1`. Artifacts remain under `PREFLIGHT_RUN_DIR/step7-observability/`.

## 8. Sampling / coverage (v2 roadmap)

Statistical coverage (`|traces| / requests ≥ 0.95`) and per-service span floors are **not** enforced in v1; reserved for `step7-strict-span-invariant-v2`.

## 9. Versioning

Validator output includes `specVersion: "rp-observability-integrity-spec-v1"`.

## 10. CI

`pnpm run validate-observability` requires `JAEGER_QUERY_BASE` pointing at a reachable Jaeger with recent traces. Typical CI uses `PREFLIGHT_STEP7_OBSERVABILITY_GATES=0` unless a Jaeger fixture is available.
