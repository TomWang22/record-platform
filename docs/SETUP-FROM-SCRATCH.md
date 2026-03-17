# Setup from scratch (after “nuclear option” / fresh Colima)

Use this when you have a fresh Colima VM (e.g. after `colima delete -f` + `colima start`) and need to bring up the full platform: **namespaces**, **cert chain**, **external 8 DBs + Redis + Kafka + Zookeeper**, and **6443** so `kubectl` works.

---

## 1. Colima (16 GB memory, 6443)

You want **16 GB** memory (not 15). If you already started with 15:

```bash
colima stop
colima start --network-address --kubernetes --cpu 12 --memory 16 --disk 256
```

Forward the API so the host can reach k3s:

```bash
./scripts/colima-forward-6443.sh
kubectl get nodes   # should succeed
```

---

## 2. Cert chain (CA + leaf + Kafka SSL)

Cert chain and Kafka TLS must exist **before** starting Kafka and before applying K8s workloads that use TLS.

From repo root:

```bash
# Creates certs/dev-root.pem, dev-root.key, record.local.crt, record.local.key and loads dev-root-ca + record-local-tls into K8s
KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh

# Kafka broker keystore/truststore + kafka-ssl-secret (uses dev-root from above)
./scripts/kafka-ssl-from-dev-root.sh
```

If `reissue` fails with connection reset, run `./scripts/colima-forward-6443.sh --restart` and retry, or use in-VM kubectl (see `REISSUE_STEP2_VIA_SSH=1` in the script header).

---

## 3. External infra: 8 Postgres, Redis, Zookeeper, Kafka

Docker Compose must be running **after** Kafka certs exist (`certs/kafka-ssl/` from step 2).

```bash
./scripts/bring-up-external-infra.sh
```

This starts: **zookeeper**, **kafka** (port 29093), **redis** (6379), and **8 Postgres** (5433–5440: records, social, listings, shopping, auth, auction-monitor, analytics, python_ai). Wait until the script reports all ports UP.

Optional: if you have a backup/dump set of the 8 DBs (e.g. a folder like `all-8-20260226-223226` with per-DB dumps), restore **after** step 4 (schemas). The **setup-from-nuclear.sh** script does this by default: it uses **RESTORE_BACKUP_DIR=backups/all-8-20260226-223226** and runs **restore-all-8-from-backup.sh** after applying schemas. To use a different bundle: `RESTORE_BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS ./scripts/setup-from-nuclear.sh`. To skip restore: `RESTORE_BACKUP_DIR= ./scripts/setup-from-nuclear.sh`. See **scripts/restore-all-8-from-backup.sh** and **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md**.

---

## 4. Schemas and tuning on all 8 DBs

```bash
./scripts/ensure-all-schemas-and-tuning.sh
```

Creates databases and applies migrations on 5433–5440. Requires Postgres reachable (step 3). If it exits with “Cannot reach Postgres”, run step 3 first and ensure Docker/Colima are up.

---

## 5. K8s: namespaces and workloads

Apply the base kustomization (namespaces, config, secrets, kafka-external, all services). Secrets were created in step 2.

```bash
kubectl apply -k infra/k8s/base
```

Then point kafka-external at the host so pods can reach Docker Kafka:

```bash
./scripts/patch-kafka-external-host.sh
```

Optional: sync TLS into other namespaces (ingress-nginx, record-platform, envoy-test). Requires `certs/record.local.crt`, `certs/record.local.key`, `certs/dev-root.pem` (from step 2). If secrets already exist you may see "field is immutable" — that’s OK.

```bash
./scripts/strict-tls-bootstrap.sh
```

**5b. Caddy (ingress-nginx, 2 replicas) and envoy-test**

On a single-node cluster (e.g. Colima), use the **LoadBalancer** Caddy deploy so both replicas can schedule (no hostPort conflict). Envoy-test is in base (1 pod).

```bash
CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh
```

Caddy will get an EXTERNAL-IP from MetalLB (e.g. 192.168.64.7). **Strict TLS + mTLS:** Caddy terminates TLS; Envoy listens plaintext (h2c); Envoy presents a client cert (from `record-local-tls` in envoy-test) to each gRPC backend; all backends have `GRPC_REQUIRE_CLIENT_CERT=true`. Cert chain is in `record-local-tls` and `dev-root-ca` in ingress-nginx, record-platform, and envoy-test. Run `strict-tls-bootstrap.sh` so envoy-test has `record-local-tls` for Envoy mTLS.

---

## 6. One-shot “ensure ready” (alternative)

If you prefer a single entry point that checks/creates API, Redis, 8 Postgres, and Kafka (and optionally runs preflight):

```bash
./scripts/ensure-ready-for-preflight.sh
```

This assumes Kafka certs already exist (step 2); otherwise start with `SKIP_KAFKA=1` and run step 2, then bring-up again without `SKIP_KAFKA`. For a **full** preflight (MetalLB, Caddy, suites):

```bash
./scripts/ensure-ready-for-preflight.sh --run
```

Or see **scripts/RUN-PREFLIGHT.md** for the full one-liner and MetalLB/route steps.

---

## Quick reference order

| Step | What |
|------|------|
| 1 | Colima 16 GB + `./scripts/colima-forward-6443.sh` |
| 2 | `KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh` then `./scripts/kafka-ssl-from-dev-root.sh` |
| 3 | `./scripts/bring-up-external-infra.sh` (8 Postgres, Redis, Zookeeper, Kafka) |
| 4 | `./scripts/ensure-all-schemas-and-tuning.sh` |
| 5 | `kubectl apply -k infra/k8s/base` + `./scripts/patch-kafka-external-host.sh` [+ `./scripts/strict-tls-bootstrap.sh`] |
| 5b | `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh` (Caddy 2 replicas, envoy-test 1 pod) |

After that you have: **namespaces**, **cert chain**, **Caddy (2) + record-platform + envoy-test (1)**, **external 8 DBs + Redis + Kafka + Zookeeper**, and **6443** for kubectl. ServiceMonitor CRDs are optional (install with `./scripts/install-prometheus-operator-crds.sh` if you need them).
