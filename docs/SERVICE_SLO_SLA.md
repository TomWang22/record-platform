# Service SLO / SLA (Prometheus)

This repo ships **example** PrometheusOperator rules under **`monitoring/prometheus-rules/service-slos.yaml`**. They assume **kube-state-metrics** (and optionally **nginx-ingress** or app `http_requests_total`) scrapes in the same Prometheus as the rules.

## Targets (edit to match your org)

| Tier | Availability (30d) | Latency (p99) | Notes |
|------|--------------------|---------------|--------|
| Edge / api-gateway | 99.9% | &lt; 500 ms | User-facing HTTP |
| auth-service | 99.95% | &lt; 300 ms | Login / token |
| Data plane (Kafka, Redis) | 99.95% | N/A | Infra alerts in other rule files |

**SLA** is the customer-facing commitment; **SLO** is the internal threshold you alert on before breaching SLA. Tune `for:` windows so on-call gets signal without noise.

## What the bundled rules do

- **Recording rules** (prefix `rp_`): optional normalizations if you add custom metrics later.
- **Alerts** (namespace **`record-platform`**):
  - Deployment **replicas unavailable** for too long (proxy for “service down”).
  - **CrashLoopBackOff** on core app pods (label `app`).

## Wiring

```bash
kubectl apply -f monitoring/prometheus-rules/service-slos.yaml -n monitoring
```

Ensure `kube_deployment_*` and `kube_pod_*` metrics exist (standard **kube-prometheus-stack**). For HTTP error budgets, export **`http_requests_total`** from **api-gateway** or ingress and extend the rule file with `sum(rate(http_requests_total{status=~"5.."}[5m]))` style expressions.

## Related

- **`monitoring/prometheus-rules/kafka-kraft-dns.yaml`** — Kafka quorum / DNS hints  
- **`docs/GDPR_ACCOUNT_DELETION_AND_ANONYMIZATION.md`** — lifecycle events (not an SLO, but operational coupling)  
