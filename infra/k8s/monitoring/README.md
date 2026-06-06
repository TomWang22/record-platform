# Optional Kubernetes monitoring snippets

- **`kafka-election-exporter-stub.yaml`** — placeholder ConfigMap documenting how to add KRaft / election metrics; **not** a runnable exporter. Prefer JMX on brokers or Strimzi’s KafkaExporter in production.

Apply only after review:

```bash
kubectl apply -f infra/k8s/monitoring/kafka-election-exporter-stub.yaml
```

PrometheusRule examples for KRaft DNS / kube-state live under **`monitoring/prometheus-rules/`** (repo root).
