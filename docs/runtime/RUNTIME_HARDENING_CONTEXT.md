# Runtime hardening context (pre-performance gate)

**Status:** PARTIAL — pre-pgbench stop line **not earned**.  
**Phase 34 AI / pgbench / k6 / Playwright full suites:** **paused**.

## What we are fixing

The platform is being hardened for **runtime acceptance** before any database or application load testing. The earlier inventory was **discovery evidence only**. Static source greps (e.g. `grpc_server_interceptor = false`) are **not** defects until composition-root registration and a live request trace prove otherwise.

We are executing gates **A→I** in order. Nothing after a red gate is treated as green.

## Honest gate classification (current)

| Gate | Classification |
|------|----------------|
| A Capability contract | Vocabulary corrected (13 services); **0** `REQUIRED_RUNTIME_PROVEN` cells |
| B Runtime provenance | `HEAD == origin/main`; prior pod SHA was rewrite-equivalent but **wrong label**; repin/rebuild still required for hardening code |
| C ReplicaSet hygiene | PASS at last 15m observation (`obsolete_rs_with_replicas = 0`) |
| D Graceful shutdown | Coordinator wired in Node entrypoints; **1/13** SIGTERM proven (media); python-ai/webapp were missing from matrix |
| E Kafka client identity | Role-suffixed IDs implemented in common; **topology census + `.role` runtime proof** still open |
| F Interceptor runtime proof | Registration/wiring only — **NOT_PROVEN** |
| G Strict transport | NOT_STARTED (known blocker: unauthorized gRPC identity accepted) |
| H Observability journeys | NOT_STARTED |
| I Pre-pgbench | **NOT_EARNED** |

## History-rewrite SHA issue (critical)

1. Local tip and `origin/main` had **identical trees** but **different commit SHAs** (rewrite drift).
2. Live pods were labeled `RP_SOURCE_SHA=3c634e18…`, which is **reachable as a git object** but **not an ancestor of `origin/main`**.
3. Local `main` was soft-reset to `origin/main` (`8bcc822e…`) so **`HEAD == origin/main`**.
4. Hardening code (shutdown coordinator, Kafka role IDs, drain endpoints, etc.) remains largely **working-tree / uncommitted** relative to that tip — **images must be rebuilt** before runtime proof of those fixes.

## What “done” means for each near-term item

1. **Provenance** — every participating pod: `RP_SOURCE_SHA == HEAD`, digest matches imageID, SHA reachable in `origin/main` history.
2. **Capability contract** — only the five allowed statuses; every N/A has trust-boundary fields; never mark proven from greps.
3. **Graceful shutdown** — shared coordinator (Node) / FastAPI drain (python); preStop calls drain (not sleep-only); full **13-service** SIGTERM matrix with replacement Ready.
4. **Kafka** — census of real producers/consumers; client IDs `record-platform.<service>.<pod-token>.<role>`; steady-state + controlled rollout + broker failover.
5. **Interceptors** — trace/metric evidence of execution, not registration filenames.
6. **Then** G (strict H1/H2/H3 + mTLS including wrong-service denial) and H (ten journeys + Prom/Grafana/alerts).
7. **Only then** pgbench.

## Artifacts to trust

| Artifact | Purpose |
|----------|---------|
| `reports/runtime/current-head-runtime-pin.json` | HEAD vs origin vs live pod SHAs |
| `reports/runtime/service-capability-contract.{json,md}` | Capability matrix (corrected vocabulary) |
| `reports/runtime/graceful-shutdown-matrix.json` | SIGTERM results (do not invent PASS) |
| `reports/runtime/gate-consolidated-report.json` | Machine-readable audit snapshot |
| `reports/kafka/*` | Identity / stability / rollout (many still PARTIAL) |
| `reports/observability/interceptor-*` | Registration vs runtime proof |

## Explicit non-goals right now

- Do **not** start pgbench, k6, Playwright full suites, or Phase 34 model work.
- Do **not** treat TLS bypass flags as acceptance.
- Do **not** omit `python-ai-service` or `webapp` from shutdown accounting.
- Do **not** report Sections A–F as complete while SIGTERM, Kafka census, and interceptor runtime proof remain open.
