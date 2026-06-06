# Record Platform — Kafka ops, certs, alignment CronJob, DNS auto-remediator, policies, SLO

**Out-of-repo** bundle with **namespace `record-platform`** (replacing **`off-campus-housing-tracker`**). **Edge / SNI in this git repo:** **`record.test`** (see **`Caddyfile`**, **`scripts/lib/edge-test-url.sh`**). The tarball text may still say **`record.local`**; treat **`record.test`** as canonical when working inside **record-platform** git.

## Contents

| Path | Role |
|------|------|
| **`infra/docker/kafka-alignment-cron/`** | Dockerfile: **kubectl + bash + openssl**; **`COPY scripts`**; runs **`kafka-runtime-sync.sh --check-only`** + **safe** **`kafka-alignment-suite.sh`**. Build from **bundle root** (parent of **`infra/`** and **`scripts/`**). |
| **`infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml`** | CronJob **`kafka-alignment-validate`** (every 30m), ServiceAccount + RBAC. Image **`kafka-alignment-cron:latest`**. |
| **`infra/k8s/kafka-certs/`** | cert-manager **ClusterIssuer** / **Certificate** CRDs, **`certificates/`**, TLS preflight Job, **README**. |
| **`infra/k8s/kafka-kraft-metallb/`** | **3-broker** KRaft StatefulSet, external Services, MetalLB hooks, exporter, PDB, RBAC. |
| **`infra/ops/`** | **`kafka-dns-auto-remediation.yaml`** — CronJob deletes stale **EndpointSlices** for Service **`kafka`**; **`kafka-quorum-check.yaml`** — **`kafka-metadata-quorum describe`** over SSL. **`kubectl apply -k infra/ops/`**. |
| **`infra/policies/kafka-replica-guard.yaml`** | **ValidatingAdmissionPolicy**: block scaling **`statefulset/kafka`** below **3** replicas in **`record-platform`** (in-tree in this monorepo). |
| **`infra/slo/error-budget-policy.md`** | SLO / error-budget narrative (align with Prometheus rules in full cluster). |
| **`monitoring/prometheus-rules/kafka-kraft-dns.yaml`** | **PrometheusRule** examples (`namespace="record-platform"`, **`kafka-*`** pods). |
| **`scripts/`** | **Full** script tree (alignment image, **`validate-kafka-dns.sh`**, **`kafka-ssl-from-dev-root.sh`**, **`run-preflight-scale-and-all-suites.sh`**, chaos, golden snapshot, …). |
| **`scripts/record-platform-tls-three-stage-verify.sh`** | **3-stage TLS** + broker parity (see below). |
| **`docs/runbooks/kafka-kraft-stale-dns-rca.md`** | Stale DNS RCA. |

## TLS three-stage script

```bash
./scripts/record-platform-tls-three-stage-verify.sh
```

Stages: **(1)** **`dev-generate-certs.sh`**, **(2)** **`kafka-ssl-from-dev-root.sh`** + **`verify-kafka-broker-keystore-jks.sh`** ( **serverAuth + clientAuth** EKU on broker JKS ), **(3)** **`reissue-ca-and-leaf-load-all-services.sh`** when **`kubectl`** + **`record-platform`** exist, **(4)** **`kafka-after-rollout-verify-brokers.sh`** when **`kafka-0`** exists (cross-broker material parity).

Env: **`HOUSING_NS`**, **`KAFKA_SSL_EXTRA_IP_SANS`**, **`SKIP_STAGE1`**, **`SKIP_STAGE2`**, **`SKIP_STAGE3`**, **`SKIP_BROKER_PARITY`**.

## Build alignment CronJob image

From **this bundle root** (where **`infra/`** and **`scripts/`** sit):

```bash
docker build -f infra/docker/kafka-alignment-cron/Dockerfile -t kafka-alignment-cron:latest .
# kind: kind load docker-image kafka-alignment-cron:latest
# k3d:  k3d image import kafka-alignment-cron:latest -c <cluster>
kubectl apply -f infra/k8s/kafka-ops/kafka-alignment-cronjob.yaml
```

## Apply order (suggested)

1. Namespace **`record-platform`** (with metadata label for VAP binding).  
2. **`kubectl apply -k infra/k8s/kafka-kraft-metallb/`**  
3. TLS material: **`record-platform-tls-three-stage-verify.sh`** → sync **`kafka-ssl-secret`** (from **`kafka-ssl-from-dev-root.sh`**; legacy docs may say **`och-kafka-ssl-secret`**).  
4. Optional: **`kubectl apply -k infra/k8s/kafka-certs/`** (cert-manager path).  
5. Topics: **`./scripts/create-kafka-event-topics-k8s.sh`**  
6. **`kubectl apply -k infra/ops/`** (DNS remediator + quorum CronJobs).  
7. **`kubectl apply -f infra/policies/kafka-replica-guard.yaml`** (if API server supports VAP).  
8. **`kubectl apply -f monitoring/prometheus-rules/kafka-kraft-dns.yaml`** (into **monitoring** or your rules NS).  
9. Alignment CronJob image + **`kafka-alignment-cronjob.yaml`**.

## Preflight

See **[RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md](./RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md)**.

## Host / SNI

Use **`https://record.test`** for edge checks (avoid **`*.local`** on macOS — mDNS); add **`/etc/hosts`** → MetalLB (or NodePort) IP. **`NODE_EXTRA_CA_CERTS`** → **`certs/dev-root.pem`**.

## License

Follow **Off-Campus-Housing-Tracker** upstream license.
