# Observability manifests (base)

- **`prometheus-rules-kafka-health.yaml`** — `ConfigMap` with Kafka JMX / alignment / CA rotation style alerts (see embedded `kafka-health.yml`). Namespace **`observability`** (create it if missing, or edit metadata and re-apply).

Apply (matches **`make sync-prometheus-kafka-rules`**):

```bash
kubectl create namespace observability --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f infra/k8s/base/observability/prometheus-rules-kafka-health.yaml
```

If you use **Prometheus Operator** `PrometheusRule` CRDs instead of a raw ConfigMap, convert or mount this file per your stack.
