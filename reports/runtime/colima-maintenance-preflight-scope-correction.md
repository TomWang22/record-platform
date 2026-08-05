# Colima maintenance preflight — scope correction

Supersedes `reports/runtime/colima-macos-network-boundary-maintenance-preflight.json` without mutating that file or the other preserved baselines.

## Correct classification

| Gate | Status |
| --- | --- |
| Network boundary discovery | **PASS** |
| Dependency ownership census | **PASS** (`13/13/0`) |
| Per-dependency route matrix | **PARTIAL** |
| Durable Service/EndpointSlice cutover | **BLOCKED** (at prior capture) |
| Persistence/restart proof | **NOT COMPLETE** |
| Final maintenance quiesce | **NOT EXECUTED** |

**Corrected:** `maintenance_window_ready = false`, `stop_default_authorized = false`.

## Denominator

- PostgreSQL instances = 11  
- Redis = 1  
- MinIO = 1  
- **Total = 13**

Prior report treated “PostgreSQL boundary = 1” as sufficient. That is invalid: each published port/instance must be protocol-proven and cut over independently.

## Prior capture gaps

- Direct authenticated PostgreSQL probes covered only **records** and **auth** (9 unproven).
- `postgres-auth-external` Service DNS was **unresolved**.
- `redis-external` still pointed at **192.168.5.2** in the captured route matrix.
- Only `postgres-records-external` and `redis-external` were prepared as durable endpoints.
- MinIO classified, **not** S3-probed.
- **14** Deployments still carried emergency `hostAliases`.
- Kafka quiesce / checkpoints / offsets / ISR / URP / quorum **not executed**.
- Volume name inventory ≠ persistence restart proof.
- `tls_mode: none` ⇒ routing may be proven; **strict DB transport security is still open**.

## Next required work

Close 13/13 Service DNS + EndpointSlice + authenticated probes, migrate consumers, remove hostAliases, land exact SHA, capture pre-stop persistence baselines — **then** (owner-started window only) run final quiesce before `colima stop default`.
