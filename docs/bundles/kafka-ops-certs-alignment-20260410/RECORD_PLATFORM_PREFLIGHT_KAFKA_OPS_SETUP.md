# Integrating this bundle with `run-preflight-scale-and-all-suites.sh`

Preflight assumes a **healthy cluster**, **TLS material**, **Kafka KRaft (3 brokers)**, **MetalLB** (when external listeners matter), and **edge** reachable at **`https://record.test`** when using this monorepo (tarball copy may still say **`record.local`**).

## 1. One-time cluster + namespace

```bash
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
# VAP binding uses namespace label kubernetes.io/metadata.name=record-platform (default on modern clusters)
```

## 2. Apply Kafka + ops manifests (this tarball)

```bash
kubectl apply -k infra/k8s/kafka-kraft-metallb/
kubectl apply -k infra/ops/                    # DNS auto-remediator + quorum CronJob
kubectl apply -f infra/policies/kafka-replica-guard.yaml   # optional VAP
```

Wait for **`kafka-0..2`** Ready.

## 3. Certificates (before preflight Kafka gates)

From **repo/bundle root** (with **`certs/`** writable):

```bash
export HOUSING_NS=record-platform
# Optional: export KAFKA_SSL_EXTRA_IP_SANS=<MetalLB IPs for :9094>
./scripts/record-platform-tls-three-stage-verify.sh
```

Apply the generated **`och-kafka-ssl-secret`** (or let **`kafka-ssl-from-dev-root.sh`** / **`reissue`** push it — follow script output). Confirm:

```bash
./scripts/verify-kafka-broker-keystore-jks.sh
HOUSING_NS=record-platform ./scripts/verify-kafka-tls-sans.sh
HOUSING_NS=record-platform ./scripts/validate-kafka-dns.sh
```

## 4. Topics

```bash
HOUSING_NS=record-platform ./scripts/create-kafka-event-topics-k8s.sh
```

## 5. Alignment CronJob (optional, parallel to preflight)

Build/import **`kafka-alignment-cron:latest`**, then:

```bash
kubectl apply -f infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml
```

Preflight **also** runs **`scripts/tests/kafka-alignment-suite.sh`** in step **6a2c9** unless skipped — the CronJob is for **continuous** validation.

## 6. Edge hostname + trust

```bash
export E2E_API_BASE=https://record.local
export NODE_EXTRA_CA_CERTS="$PWD/certs/dev-root.pem"
# If DNS missing: export OCH_EDGE_IP=<LB IP> and use scripts/lib/edge-test-url.sh hints or OCH_AUTO_EDGE_HOSTS=1
```

## 7. Run preflight

```bash
export HOUSING_NS=record-platform
export REQUIRE_COLIMA=0          # or 1 for Colima-only path
export METALLB_ENABLED=1         # if using MetalLB for edge + Kafka external
./scripts/run-preflight-scale-and-all-suites.sh
```

**Useful skips** (see preflight header for full list):

| Variable | Effect |
|----------|--------|
| **`PREFLIGHT_SKIP_KAFKA_ALIGNMENT_SUITE=1`** | Skip in-preflight alignment suite (you still have CronJob). |
| **`PREFLIGHT_SKIP_KAFKA_KRAFT_HEALTH_GATES=1`** | Skip full **`verify-kafka-cluster`** ritual (not recommended for prod-like). |
| **`PREFLIGHT_SKIP_KAFKA_EKU_CHECK=1`** | Skip broker **clientAuth** EKU openssl gate. |
| **`RUN_PREFLIGHT_PLAYWRIGHT=0`** | Skip Playwright if **`webapp/`** not present. |
| **`RUN_SUITES=0`** | Infra gates only. |

## 8. cert-manager path (optional)

```bash
kubectl apply -k infra/k8s/kafka-certs/
```

Brokers still expect **JKS** in **`kafka-ssl-secret`** today — use init containers or keep **`kafka-ssl-from-dev-root.sh`** until PEM/JKS wiring per pod is implemented (**`infra/k8s/kafka-certs/README.md`**).

## 9. Prometheus rules

```bash
kubectl apply -f monitoring/prometheus-rules/kafka-kraft-dns.yaml -n monitoring
```

Adjust **namespace** in the file if your Prometheus Operator watches a different namespace.

## 10. Operational scripts referenced by **`infra/ops/README.md`**

- **`./scripts/validate-kafka-dns.sh`** — manual stale-DNS check (matches DNS remediator logic).  
- **`./scripts/cleanup-kafka-ops-cronjob-pods.sh`** — prune finished CronJob pods (if present in **`scripts/`**).

This bundle’s **`infra/ops`** CronJobs use **`record-platform`** after unpack (no **`HOUSING_NS`** override inside the embedded **`validate.sh`** — it is baked into the ConfigMap as **`record-platform`**).
