# Run Full Pipeline

Runs **reissue** (CA/Caddy match) → **Kafka strict TLS** (kafka-ssl-secret, dev-root-ca) → **preflight** (scale, remove in-cluster Postgres/Kafka/ZK) → **all 5 test suites** (baseline, enhanced, adversarial, rotation, standalone). Logs to `run-all-suites.log`.

## Kill idle processes, then run (recommended if you hit "fork" or stuck runs)

Finds and kills stale pipeline/test processes (run-full-pipeline, run-preflight, k6, etc.), then runs the full pipeline:

```bash
cd /Users/tom/record-platform
export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
./scripts/find-and-kill-idle-then-run-pipeline.sh
```

- **List only (no kill):** `KILL=0 ./scripts/find-and-kill-idle-then-run-pipeline.sh`
- **Kill only (don't run pipeline):** `KILL=1 KILL_ONLY=1 ./scripts/find-and-kill-idle-then-run-pipeline.sh`
- **Just list pipeline-related PIDs:** `./scripts/list-idle-pipeline-processes.sh` or `./scripts/list-idle-pipeline-processes.sh mylog.txt`
- Logs to `idle-kill-and-pipeline.log` and `run-all-suites.log`.

To kill stale processes when running the preflight pipeline directly (without find-and-kill), use **`KILL_STALE_FIRST=1`**:

```bash
KILL_STALE_FIRST=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

## One-liner (from repo root)

```bash
cd /Users/tom/record-platform && export PATH="$(pwd)/scripts/shims:/opt/homebrew/bin:/usr/local/bin:$PATH" && ./scripts/run-full-pipeline.sh
```

Or:

```bash
pnpm run full-pipeline
```

## Prerequisites

- **kubectl** pointing at Colima + k3s (recommended)
- **keytool** (Java) and **openssl** for Kafka strict TLS
- **Docker** (Compose) for Zookeeper, Kafka (strict TLS :29093), Redis, Postgres (all external)
- Cluster has `record-platform`, `envoy-test`, `ingress-nginx`; base applied (e.g. `kubectl apply -k infra/k8s/base`) — **in-cluster Postgres, Kafka, ZK are removed** by the pipeline

## Duration

~30–60 minutes. Watch progress:

```bash
tail -f run-all-suites.log
```

### If step 3a (Reissue) or 3b (Kafka SSL) appears stuck

The reissue script emits `[reissue] step N: ...` lines. To see where the pipeline is:

```bash
tail -f run-all-suites.log | grep -E '\[reissue\]|Reissue done|3a\.|3b\.|Kafka SSL|Verify Caddy|Running all test'
```

Reissue runs in **3a** (always). Use `REISSUE_CAP=300` to cap it. Kafka strict TLS uses **dev-root-ca** (same as Caddy); `pnpm run kafka-ssl` creates `kafka-ssl-secret` (run after reissue with `KAFKA_SSL=1`).

## Run in background

```bash
nohup ./scripts/run-full-pipeline.sh >> run-all-suites.log 2>&1 &
tail -f run-all-suites.log
```
