# Kafka KRaft — 3 brokers + MetalLB externals (namespace `record-platform`)

## Apply

```bash
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
# TLS secret first (see docs/kafka/KRAFT_THREE_BROKER_TLS.md)
./scripts/kafka-ssl-from-dev-root.sh
kubectl apply -k infra/k8s/kafka-kraft-metallb/
```

Staged apply (wait for LB IPs before refreshing broker SANs): **`make apply-kafka-kraft`** → **`scripts/apply-kafka-kraft-staged.sh`**.

## What’s in this directory

- **`statefulset.yaml`** — `kafka`, **3** replicas, **Parallel** pod management, **`kafka-ssl-secret`** volume, INTERNAL **:9093** / EXTERNAL **:9094** / CONTROLLER **:9095**.
- **`headless-service.yaml`**, **`external-services.yaml`** — per-broker **LoadBalancer** for **:9094**.
- **`kafka-pdb.yaml`**, **`rbac-kafka-svc-reader.yaml`**, **`kafka-metallb-alignment-exporter.yaml`**, **`exporter.py`**.

## Related

- **TLS + EKU (serverAuth + clientAuth):** **`docs/kafka/KRAFT_THREE_BROKER_TLS.md`**
- **Ops CronJobs:** **`infra/ops/README.md`**
- **Replica guard:** **`infra/policies/kafka-replica-guard.yaml`**
