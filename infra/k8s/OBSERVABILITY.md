# Observability Stack

This document describes the comprehensive observability stack for the Record Platform microservices architecture.

## Components

### 1. Prometheus (Metrics Collection)
- **Namespace:** `monitoring`
- **Deployment:** Helm chart `kube-prometheus-stack`
- **Access:** `kubectl port-forward svc/monitoring-kube-prom-prometheus -n monitoring 9090:9090`
- **UI:** http://localhost:9090

**Features:**
- Scrapes metrics from all services via ServiceMonitors and PodMonitors
- Stores metrics for 30 days
- 50Gi storage allocated
- Alertmanager for alerting

### 2. Grafana (Visualization)
- **Namespace:** `monitoring`
- **Deployment:** Part of `kube-prometheus-stack`
- **Access:** `kubectl port-forward svc/monitoring-grafana -n monitoring 3000:80`
- **UI:** http://localhost:3000
- **Credentials:**
  - Username: `admin`
  - Password: `Admin123!`

**Dashboards:**
- Microservices Overview (request rate, error rate, response times)
- Distributed Tracing metrics
- Kubernetes cluster metrics (CPU, memory, pods)
- Custom dashboards in `infra/k8s/base/observability/grafana-dashboards.yaml`

### 3. Jaeger (Distributed Tracing)
- **Namespace:** `observability`
- **Deployment:** All-in-one Jaeger container
- **Access:** `kubectl port-forward svc/jaeger -n observability 16686:16686`
- **UI:** http://localhost:16686

**Endpoints:**
- Query UI: `16686`
- HTTP Collector: `14268`
- gRPC Collector: `14250`

**Features:**
- Receives traces via OpenTelemetry Collector
- Visualizes distributed traces across microservices
- Search and filter traces by service, operation, tags

### 4. OpenTelemetry Collector
- **Namespace:** `observability`
- **Deployment:** OTel Collector Contrib
- **Service:** `otel-collector.observability.svc.cluster.local`

**Endpoints:**
- OTLP gRPC: `4317`
- OTLP HTTP: `4318`
- Prometheus metrics: `8889`

**Exporters:**
- **Jaeger:** Sends traces to Jaeger for visualization
- **Prometheus:** Exports metrics to Prometheus
- **New Relic:** Optional, exports traces/metrics/logs to New Relic (if license key configured)

**Configuration:** `infra/k8s/base/observability/otel-collector-deploy.yaml`

### 5. Linkerd Service Mesh
- **Namespace:** `linkerd`, `linkerd-viz`
- **Installation:** `bash infra/k8s/scripts/install-linkerd.sh`

**Features:**
- Automatic mTLS between services
- Service-level metrics (request rate, latency, success rate)
- Traffic splitting and canary deployments
- Automatic retries and timeouts
- Distributed tracing integration

**Dashboards:**
- Linkerd Viz: `linkerd viz dashboard`
- Shows topology, metrics per service, live traffic

**Auto-injection:**
```bash
# Enable for a namespace
kubectl annotate namespace record-platform linkerd.io/inject=enabled

# Inject a specific deployment
kubectl get deployment api-gateway -n record-platform -o yaml | \
  linkerd inject - | kubectl apply -f -
```

### 6. New Relic (Optional)
- **Integration:** Via OpenTelemetry Collector
- **Setup:** Set `NEW_RELIC_LICENSE_KEY` environment variable
- **Secret:** `newrelic-secret` in `observability` namespace

To enable:
```bash
kubectl create secret generic newrelic-secret \
  --from-literal=license-key="YOUR_LICENSE_KEY" \
  -n observability
```

## Installation

### Full Stack Installation

```bash
# Install everything (Prometheus, Grafana, Jaeger, OTel, Linkerd)
bash infra/k8s/scripts/install-observability.sh
```

### Individual Components

```bash
# Just Linkerd
bash infra/k8s/scripts/install-linkerd.sh

# Manual Prometheus/Grafana (or use Helm)
kubectl apply -k infra/k8s/base/observability
```

## Service Instrumentation

### Node.js/TypeScript Services

1. Install dependencies:
   ```bash
   pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-otlp-grpc
   ```

2. Create `instrumentation.ts`:
   ```typescript
   import { NodeSDK } from '@opentelemetry/sdk-node'
   import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
   import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-grpc'

   const sdk = new NodeSDK({
     traceExporter: new OTLPTraceExporter({
       url: 'http://otel-collector.observability.svc.cluster.local:4317',
     }),
     instrumentations: [getNodeAutoInstrumentations()],
   })
   sdk.start()
   ```

3. Import first in your service entry point:
   ```typescript
   import './instrumentation'  // Must be first!
   ```

4. Add environment variables to deployment:
   ```yaml
   env:
     - name: OTEL_EXPORTER_OTLP_ENDPOINT
       value: "http://otel-collector.observability.svc.cluster.local:4317"
     - name: OTEL_SERVICE_NAME
       value: "api-gateway"
   ```

See `infra/k8s/base/observability/otel-instrumentation.md` for detailed guide.

## Metrics Collected

### Service Metrics (Prometheus)
- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request latency (histogram)
- `http_request_size_bytes` - Request size
- `http_response_size_bytes` - Response size

### Linkerd Metrics
- `request_total` - Total requests per service
- `response_latency_ms_bucket` - Response latency percentiles
- `tcp_open_connections` - Active TCP connections

### Custom Business Metrics
- Record operations (create, update, delete)
- Database query duration
- Cache hit/miss rates
- Kafka message processing rate

## ServiceMonitors & PodMonitors

### ServiceMonitors
Located in:
- `infra/k8s/base/monitoring/servicemonitors.yaml` - Core services
- `infra/k8s/base/observability/servicemonitors.yaml` - Observability components

### PodMonitors
Located in:
- `infra/k8s/base/observability/podmonitors.yaml` - Service pods and infrastructure

## Grafana Dashboards

### Pre-built Dashboards
1. **Microservices Overview** - Request rate, error rate, response times (p95, p99)
2. **Distributed Tracing** - Trace count, error rate by service
3. **Kubernetes Cluster** - CPU, memory, pod status (from kube-prometheus-stack)
4. **Linkerd** - Service mesh metrics (topology, traffic, latency)

### Custom Dashboards
Add JSON dashboards to `infra/k8s/base/observability/grafana-dashboards.yaml` ConfigMap.

## Alerting

### Prometheus AlertManager
Configure alerts in Prometheus:
```yaml
groups:
  - name: microservices
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate in {{ $labels.service }}"
```

## Troubleshooting

### Traces Not Appearing in Jaeger
1. Check OTel Collector logs:
   ```bash
   kubectl logs -n observability deployment/otel-collector -f
   ```

2. Verify service instrumentation:
   ```bash
   kubectl exec -n record-platform deployment/api-gateway -- \
     curl http://otel-collector.observability.svc.cluster.local:4318/v1/traces
   ```

3. Check Jaeger service:
   ```bash
   kubectl get svc jaeger -n observability
   ```

### Metrics Not Scraping
1. Verify ServiceMonitor/PodMonitor:
   ```bash
   kubectl get servicemonitors -n monitoring
   kubectl get podmonitors -n observability
   ```

2. Check Prometheus targets:
   - Open Prometheus UI: http://localhost:9090
   - Navigate to Status → Targets

### Linkerd Not Injecting
1. Verify namespace annotation:
   ```bash
   kubectl get namespace record-platform -o yaml | grep linkerd
   ```

2. Check Linkerd status:
   ```bash
   linkerd check
   ```

3. Manually inject:
   ```bash
   kubectl get deployment api-gateway -o yaml | linkerd inject - | kubectl apply -f -
   ```

## Access URLs

| Component | Port Forward | URL |
|-----------|-------------|-----|
| Grafana | `kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80` | http://localhost:3000 |
| Prometheus | `kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090` | http://localhost:9090 |
| Jaeger | `kubectl -n observability port-forward svc/jaeger 16686:16686` | http://localhost:16686 |
| Linkerd Viz | `linkerd viz dashboard` | Auto-opens in browser |

## Next Steps

1. **Instrument all services** with OpenTelemetry
2. **Enable Linkerd** for traffic management and mTLS
3. **Create custom dashboards** for business metrics
4. **Set up alerting** for critical metrics
5. **Configure New Relic** for external monitoring (optional)

## Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Linkerd Documentation](https://linkerd.io/2/getting-started/)

