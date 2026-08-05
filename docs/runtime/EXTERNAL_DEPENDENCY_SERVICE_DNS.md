# External dependency Service DNS (Colima)

Durable routing for Compose Postgres/Redis/MinIO uses selectorless Services + reconciled Endpoints/EndpointSlices.

## Contract

| Dependency | Service DNS | Port |
| --- | --- | --- |
| postgres-* (11) | `postgres-<name>-external.record-platform.svc.cluster.local` | published 5433–5443 |
| redis | `redis-external.record-platform.svc.cluster.local` | 6379 |
| minio | `minio-external.record-platform.svc.cluster.local` | 9000 / 9001 |

Reconciler: `scripts/reconcile-external-endpoints.sh`  
Resolver: `scripts/lib/rp-resolve-external-dependency-endpoint.sh` (requires `TARGET_EXECUTION_PLANE`; no silent `.64.7`↔`.5.2` fallback).

## Bootstrap DAG

`C.infra` + `F.namespace.prepare` → `B.colima_network.discover` → classify → resolve → protocol_verify → `D.external_endpoints.materialize` → verify → `F.cluster_deploy` / `G.app_runtime`.

## Emergency hostAliases

`scripts/colima-apply-host-aliases.sh` requires `RP_ALLOW_EMERGENCY_HOSTALIASES=1` and an explicit plane. Not durable.

## Transport security

Routing proof ≠ TLS proof. Current disposition: `ROUTING_PROVEN_SECURITY_GATE_STILL_OPEN`.
