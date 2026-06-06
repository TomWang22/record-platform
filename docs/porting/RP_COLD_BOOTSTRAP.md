# Record Platform cold bootstrap (Colima / k3s)

## Operator command (one command — embeds cluster-doctor + verify-bootstrap-state)

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap
```

Do **not** run `make cluster-doctor` separately during bootstrap; it runs in phase **J.final_contract** inside `cold-bootstrap.sh`. Edge smoke runs only after `/etc/hosts` via `make rp-preflight-network-contract`.

`RESTORE_BACKUP_DIR` may be:

- a raw OCH or RP `backups/all-8-<date>` folder (auto-pairs the other snapshot and materializes), or
- `backups/hybrid-rp-och/materialized-rp-runtime` (already materialized).

No `RP_SKIP_*` / `RP_ENABLE_*` / `RP_PAUSE_*` flags are required on the CLI — defaults live in `scripts/cold-bootstrap.sh`.

## Cluster doctor (standalone)

```bash
make bootstrap-invariants-order   # phase DAG order JSON
make cluster-doctor               # bench_logs/cluster-doctor.json
make verify-bootstrap-state       # bench_logs/bootstrap-state-verify-latest.json
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor   # fail if score < 95
```

## Dry-run plan

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap-plan
# or: make -n cold-bootstrap   (prints Make recipe only)
```

## Prerequisites only

```bash
make rp-bootstrap-prereqs
bash backups/hybrid-rp-och/validate-hybrid-backup.sh backups/hybrid-rp-och/materialized-rp-runtime
```

## Docker Compose (external infra only)

`docker-compose.yml` is **not** an app stack. It provides host-side substrate only:

- Postgres **5433–5443**, Redis **6379**, MinIO **9000/9001**, Jaeger, Mailpit
- **No** Confluent Kafka, Zookeeper, HAProxy, Nginx, Prometheus/Grafana, or compose app services
- Kafka = **k3s only** (`infra/k8s/kafka-kraft-metallb/`, 3-broker KRaft, MetalLB, strict TLS/mTLS)
- App services = **k3s only** (`record-platform` namespace)

Verify before bootstrap:

```bash
docker compose config --services
bash scripts/rp-verify-compose-contract.sh
```

## DAG phases (cold-bootstrap.sh)

| Phase | Node | Work |
|-------|------|------|
| A | workspace | venv + `pnpm install --frozen-lockfile` + `pnpm run build`; fail if booking/social in workspace |
| P0 | hard_reset | **Destructive boundary:** kill jobs; colima stop/delete; rm `~/.colima` (quiet logs) |
| Z | colima_clean | native `colima start`, 90s k3s settle, VM tools summary, bridge kubeconfig |
| A.toolchain | toolchain | Node 22.x (>=22.13) + pnpm@11.1.3 via corepack (fnm install/use 22 automatically) |
| P1 | host_deps | toolchain contract + docker, curl HTTP/3, openssl, kubectl, pip==26.1.1 venv (after Colima/kube context exists) |
| B | crypto | 3-stage CA, strict-tls K8s secrets, Kafka TLS material (disk); creates `record-platform` namespace |
| C | infra | namespaces, strict-tls, compose external infra only (5433–5443, Redis, MinIO); `docker compose config` → `bench_logs/command-logs/C.infra/` only |
| C.metrics | metrics-server | kube-system metrics-server (after restore) |
| C.images | required images | **build + load** diagnostic edge images (see below); not app `:dev` images |
| C.image_contract | image_contract | Static Dockerfile / webapp standalone contracts |
| D.contract_audits | contract_audits | `make rp-audit-bootstrap-contract` (gateway, runtime, probes, health source) |
| E.build_images | build_images | `make build-images` — every active `:dev` image gets `RP_SOURCE_SHA` + `GIT_COMMIT` labels |
| E.image_freshness | image_freshness | `bash scripts/audit-rp-image-freshness.sh` — **hard gate**; set `RP_SKIP_IMAGE_FRESHNESS=1` only to bypass (untrusted run) |
| D | backup_materialization | materialize hybrid → `materialized-rp-runtime`, validate 11 DBs |
| E | restore | restore 5433–5443 only |
| F | cluster_deploy | namespace **ensure** + `make bootstrap` — **refuses stale images** unless freshness skipped |
| G | app_runtime | rollouts + `/healthz` + latency percentiles |
| H | observability | Prometheus/Grafana/Jaeger (when enabled) |
| I | transport | Caddy MetalLB IP; **pause for /etc/hosts** (no edge smoke) |
| J | final_contract | cluster-doctor, verify-bootstrap-state, drift, bench_logs artifacts |

Progress JSON: `bench_logs/bootstrap_state_progress.json`. Wall clock: `bench_logs/cold-bootstrap-last-timing.json`.

## C.images — diagnostic edge images (automatic)

**Do not** run ad-hoc `docker build -t caddy-with-tcpdump:dev` before cold-bootstrap. Phase **C.images** owns:

1. `scripts/rp-build-required-images.sh` — build on **host Docker** (logs: `bench_logs/command-logs/C.images/build-*.log`)
2. `scripts/ensure-required-images.sh` — `docker save | colima ssh docker load` into Colima VM Docker
3. `scripts/verify-required-images.sh` — confirm host + Colima have both tags

Images (from `infra/required_images.json`):

| Tag | Dockerfile | Tools |
|-----|------------|-------|
| `caddy-with-tcpdump:dev` | `docker/caddy-with-debug-tools.Dockerfile` | xcaddy/Caddy, tcpdump, tshark, strace, htop, curl |
| `envoy-with-tcpdump:dev` | `docker/envoy-with-debug-tools.Dockerfile` | envoy, tcpdump, tshark, strace, htop, curl |

Standalone checks:

```bash
make rp-build-required-images
make rp-verify-required-images
bash scripts/ensure-required-images.sh   # build (unless RP_SKIP_REQUIRED_IMAGE_BUILD=1) + load
```

Force rebuild: `RP_FORCE_REBUILD_IMAGES=1 make rp-build-required-images`.

Cluster doctor / DAG details: [RP_CLUSTER_DOCTOR_DAG.md](./RP_CLUSTER_DOCTOR_DAG.md). OCH toolkit reference (diff only): `toolkit-reference/och-cold-bootstrap-toolkit/`.

## Runtime DB map (restore targets)

| Port | Service | Source |
|------|---------|--------|
| 5433 | records | RP `5433-records` |
| 5434 | messaging | OCH `5444-messaging` |
| 5435 | listings | OCH `5442-listings` + RP overlay SQL |
| 5436 | shopping | RP `5436-shopping` |
| 5437 | auth | RP `5437-auth` |
| 5438 | auction_monitor_core | RP `5438-postgres` (auction-monitor/core; DB `postgres`) |
| 5439 | analytics | OCH `5447-analytics` |
| 5440 | python_ai | RP `5440-python_ai` |
| 5441 | notification | OCH `5445-notification` |
| 5442 | trust | OCH `5446-trust` |
| 5443 | media | OCH `5448-media` |

**Skipped:** bookings, social, OCH auth 5441, old RP analytics 5439 as live analytics.

## Namespace policy (F.cluster_deploy)

- **P0** is the only normal destructive cluster reset (Colima factory reset).
- **B.crypto** creates `record-platform` + TLS secrets via `strict-tls-bootstrap.sh`.
- **F.cluster_deploy** ensures namespaces exist; it does **not** delete `record-platform` by default.
- **`make bootstrap`** (nested in F) also skips housing-namespace delete unless forced.

Terminal (default):

```text
Pre-bootstrap namespace check
record-platform   Active
✅ namespace cleanup skipped — P0 hard reset already produced clean cluster
  ▶ namespace ensure
✅ record-platform namespace ensured
```

Manual recovery only (stuck finalizers / mixed OCH+RP cluster):

```bash
RP_FORCE_NAMESPACE_DELETE=1 COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=... make cold-bootstrap
# or standalone:
RP_FORCE_NAMESPACE_DELETE=1 bash scripts/rp-clean-old-namespaces.sh
```

Destructive dev helpers (not cold-bootstrap): `scripts/dev-reset.sh`, `scripts/dev-down.sh`.

After hosts:

```bash
make rp-preflight-network-contract
```

## Trusted bootstrap modes

| Mode | Env | Trusted for |
|------|-----|-------------|
| **A — Full dev + ML** (default) | `RP_ENABLE_OLLAMA=1`, `OLLAMA_REQUIRED=1` | Core + Ollama stack Ready + gateway/worker + endpoint gates. `RP_OLLAMA_REQUIRE_MODEL=0` skips heavy model pull. |
| **B — Core only** (explicit opt-out) | `RP_CORE_ONLY_BOOTSTRAP=1` or `RP_ENABLE_OLLAMA=0` | Marketplace/runtime, gRPC mTLS, edge TLS only. Banner: core-only bootstrap. |
| **C — Recovery / resume** | `BOOTSTRAP_SKIP_*`, `BOOTSTRAP_RESUME=1` | Partial trust — not a full cold-bootstrap. |

B.crypto runs the full cert sequence automatically (no manual pre-steps): `dev-generate-certs` → `audit-rp-cert-coverage` → `strict-tls-bootstrap` → `audit-rp-k8s-service-tls-secrets` (when cluster API is up).

## Service mTLS cert coverage (hard trust gate)

Source of truth: `infra/contracts/rp-service-runtime-contract.json` → `certPolicy.mtlsServices` (11 leaves).

- Disk: `bash scripts/dev-generate-certs.sh` (contract-driven, no hardcoded partial list)
- Audit: `bash scripts/audit-rp-cert-coverage.sh` (required before trusting B.crypto)
- K8s model: per-service `service-tls-<service>` + combined `rp-service-mtls-bundle`; edge alias `service-tls` / `edge-service-tls` for gateway mounts. See `docs/SERVICE_TLS_K8S_MODEL.md`.

B.crypto proof must list every active mTLS service, including **records-service**, **shopping-service**, **analytics-service**, **python-ai-service**, and **auction-monitor**.
