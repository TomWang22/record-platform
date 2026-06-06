# Aligning this bundle with Record Platform

The OCH scripts assume a **monorepo root** (`REPO_ROOT`) with **`scripts/`** at `$REPO_ROOT/scripts`, **`infra/`** at `$REPO_ROOT/infra`, and **`proto/`** at `$REPO_ROOT/proto`. The **Makefile** uses `$(REPO_ROOT)` and `$(SCRIPTS)` the same way.

## 1. Unpack location

**Option A — drop-in folder:** Unpack so this directory **is** your automation root:

```bash
export REPO_ROOT="$(pwd)"   # directory containing Makefile + scripts + infra + proto
make verify-kafka-cluster
```

**Option B — merge into Record Platform:** Copy `scripts/`, `infra/`, `proto/`, and merge **Makefile** targets (or run `make -C /path/to/bundle …`). Update every path that still says `off-campus-housing` or `Off-Campus-Housing-Tracker`.

## 2. Namespace and cluster names (search & replace)

Across **`scripts/`**, **`infra/k8s/`**, and workflows, expect:

| OCH default | Replace with (example) |
|-------------|-------------------------|
| `off-campus-housing-tracker` | Your K8s namespace (e.g. `record-platform`) |
| `HOUSING_NS` | Your env var (e.g. `RECORD_PLATFORM_NS` — then export or sed scripts) |
| `off-campus-housing.test` | Your edge DNS / TLS SANs |
| `ingress-nginx` | Your ingress namespace if different |

**Practical approach:** after copying into Record Platform, run a **scoped** replace:

```bash
# Example only — verify each hit before committing
rg -l 'off-campus-housing-tracker' scripts infra .github Makefile | xargs sed -i '' 's/off-campus-housing-tracker/record-platform/g'
```

## 3. Kafka topic prefix (`ENV_PREFIX`)

Event topics are derived from **`proto/events/*.proto`** and **`scripts/lib/och-kafka-event-topics-from-proto.sh`**. Defaults use `ENV_PREFIX=dev` (or service-specific prefixes). For Record Platform:

- Set **`ENV_PREFIX`** (and **`OCH_KAFKA_TOPIC_SUFFIX`** for CI isolation) consistently in **services** and **scripts**.
- Or set **`PROTO_EVENTS_ROOT`** if your protos live outside `$REPO_ROOT/proto/events`.

Run after any proto change:

```bash
./scripts/verify-proto-events-topics.sh
```

## 4. Postgres ports and Docker Compose

Many scripts use **5441–5448** for per-service Postgres on the host. Record Platform may use **one** database or different ports:

- Grep **`5441`**, **`PGPORT`**, **`PGHOST`**, **`host.docker.internal`** in `scripts/` and adjust defaults or use env vars (most scripts already honor `PGHOST`/`PGPORT`).

## 5. `pnpm` / Node / Python tooling

The **Makefile** calls **`pnpm`**, **`pip`**, and **venv** paths (e.g. Kafka alignment report). Record Platform should either:

- Install the same toolchain and keep **`package.json`**-adjacent scripts where Makefile expects them, or  
- Trim Makefile targets you do not use and point **`KAFKA_ALIGNMENT_REPORT_VENV`** (or equivalent) at your layout.

## 6. Colima / k3s / MetalLB

OCH’s happy path is **Colima + k3s + MetalLB**. If Record Platform uses **EKS**, **kind**, or **GKE**:

- Keep **`infra/k8s/kafka-kraft-metallb/`** as a **reference** for 3-broker KRaft + external Services; replace LoadBalancer integration with your cloud’s LB or NodePort strategy.
- **`verify-preflight-edge-routing.sh`** and **`make verify-curl-http3`** are OCH-edge-specific; disable or rewrite for your edge.

## 7. CI workflows (`.github/workflows`)

Bundled workflows reference **OCH paths** and **ubuntu** shellcheck. Copy into Record Platform’s `.github/workflows/` and:

- Narrow **`paths:`** filters to your repo layout.
- Align **branch** names with your default branch.

## 8. Secrets and TLS

**`kafka-ssl-from-dev-root.sh`**, **`ensure-dev-root-ca.sh`**, and **`generate-canonical-dev-tls.sh`** (if pulled via Makefile) assume a **dev-root CA** under **`certs/`**. For Record Platform production, swap in **cert-manager**, **ACM**, or your PKI; keep the **same conceptual split**:

- Broker: JKS in **`kafka-ssl-secret`** (or Strimzi/operator equivalent).
- Apps: PEM trio **`ca-cert.pem`**, **`client.crt`**, **`client.key`** mounted for Kafka clients.

## 9. Verification checklist

- [ ] `rg REPO_ROOT scripts/*.sh | head` — scripts resolve `REPO_ROOT` from script dir + `..` (two levels for `scripts/foo/bar.sh` may differ — spot-check **`SCRIPT_DIR`** patterns).
- [ ] `make verify-kafka-cluster` (or run **`scripts/verify-kafka-cluster.sh`** with correct `kubectl` context).
- [ ] `./scripts/verify-proto-events-topics.sh`
- [ ] Prometheus scrapes your services; rule files in **`infra/k8s/base/observability/`** and **`infra/monitoring/prometheus/rules/`** match your **metric names** (see **OUTBOX_AND_OBSERVABILITY.md**).
