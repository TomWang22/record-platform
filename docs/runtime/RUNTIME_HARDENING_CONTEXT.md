# Runtime hardening context (pre-performance gate)

**Status:** PARTIAL — pre-pgbench stop line **not earned**.  
**Phase 34 AI / pgbench / k6 / Playwright full suites:** **paused**.  
**Active pin:** `HARDENING_SHA=47d1afbe617c2d784c04297c3097d0a612812e26` (`origin/main` tip).  
**Orchestrator:** `make runtime-heartbeat-acceptance` → evidence root `/tmp/record-platform-runtime-heartbeat-v1/`.  
**Hard gate:** Tickets **2–6** must PASS before Tickets 7+ (observability journeys / soak).

## What we are fixing

The platform must prove **real authenticated work** across transport, DB, cache, outbox, Kafka, consumers, observability, and inference — not merely that pods are Running. Pod replacement alone is **not** graceful shutdown.

## Honest gate classification (current)

| Gate | Classification |
|------|----------------|
| A Capability contract | PARTIAL |
| B Runtime provenance | **PASS** (exact-SHA pin; re-verify via Ticket 1) |
| C ReplicaSet hygiene | **PASS** (15m on pin; re-verify if redeployed) |
| D Graceful shutdown | **PARTIAL_SEMANTICS_NOT_FULLY_PROVEN** — 13/13 pod replacement Ready only; drain/refusal/Kafka/outbox/telemetry lifecycle not fully observed |
| E Kafka runtime | PARTIAL |
| F Interceptor execution | NOT_PROVEN |
| G Strict transport | **BLOCKED_UNAUTHORIZED_PEER_ACCEPTED** (peer-auth source + unit tests only; Ticket 2 is PKI_MATERIAL_AND_MOUNT_INTEGRITY only — not RUNTIME_MTLS) |
| H Observability journeys | NOT_STARTED (blocked until Tickets 3–6 live-proven) |
| I Pre-performance | **NOT_EARNED** |

**v1 evidence root:** `/tmp/record-platform-runtime-heartbeat-v1/` = **FROZEN_BLOCKED_EVIDENCE** (immutable; do not rewrite).  
**Dirty-tree classification:** `/tmp/record-platform-runtime-heartbeat-v1-analysis/dirty-tree-classification.json`  
**v2:** create only after clean exact-SHA pin with `oci_revision` 13/13.

## Completed on this pin

1. Clean worktree build at `47d1afbe…` → Colima load → provenance patch → one-at-a-time rollout (`reports/runtime/post-hardening-rollout.json`).
2. Restored missing `hostAliases` on media/messaging/notification/trust/webapp (Colima → `192.168.5.2`) after trust stuck on `ENOTFOUND host.docker.internal`.
3. 15-minute steady-state **PASS** (`reports/runtime/all-service-rollout-stability-15m.json`).
4. Full 13-workload SIGTERM matrix **13/13 PASS** (`reports/runtime/graceful-shutdown-matrix.json`).
5. Consolidated snapshot: `reports/runtime/gate-consolidated-report.{json,md}`.

### Known drain/build-info gaps on this pin (do not invent stronger PASS)

- `analytics-service`: custom `/healthz`/`/readyz`; **no** `mountRpHttpHealth` → `/internal/build-info` 404; preStop drain is best-effort (`|| true`).
- `api-gateway`: `/internal/build-info` returns **401** (auth middleware); drain may be blocked the same way.
- `webapp`: Next.js — no `/internal/*` drain/build-info; post-SIGTERM node `readyz` fetch failed though kubelet Ready=true.

## History-rewrite SHA issue (resolved for this pin)

1. Local tip and `origin/main` had identical trees but different SHAs (rewrite drift).
2. Prior live label `RP_SOURCE_SHA=3c634e18…` was **not** an ancestor of `origin/main`.
3. Hardening landed as commits on `origin/main`; tip is now `47d1afbe…` and live pods match.

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
