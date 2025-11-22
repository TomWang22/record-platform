# Grafana Quick Start Guide

This guide shows you how to access and use Grafana for monitoring your microservices.

## Quick Access

### Option 1: Automated Script
```bash
bash infra/k8s/scripts/access-observability.sh
```
This will automatically set up port-forwards for Grafana, Prometheus, and Jaeger.

### Option 2: Manual Port-Forward
```bash
# Grafana (in one terminal)
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80

# Then open in browser
open http://localhost:3000
```

**Credentials:**
- Username: `admin`
- Password: `Admin123!`

## First Steps in Grafana

### 1. Verify Prometheus Datasource

1. Go to **Configuration** → **Data Sources** (gear icon on left)
2. You should see **Prometheus** already configured
3. Click on it to verify:
   - URL: `http://monitoring-kube-prom-prometheus.monitoring.svc.cluster.local:9090`
   - Status should be "Green" (working)

### 2. View Pre-built Dashboards

1. Go to **Dashboards** → **Browse** (four squares icon)
2. You'll see several pre-built dashboards:
   - **Kubernetes / Compute Resources / Cluster** - Cluster-wide CPU/Memory
   - **Kubernetes / Compute Resources / Namespace (Pods)** - Pod-level metrics
   - **Kubernetes / Compute Resources / Pod** - Individual pod metrics
   - **Kubernetes / Networking / Cluster** - Network metrics
   - **Node Exporter Full** - Node-level metrics

3. Click on any dashboard to explore

### 3. Search for Your Services

1. In the **Explore** view (compass icon), select **Prometheus** datasource
2. Try these queries:

**Request rate by service:**
```promql
sum(rate(http_requests_total[5m])) by (service)
```

**Error rate:**
```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
```

**Response time (p95):**
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))
```

**CPU usage by pod:**
```promql
rate(container_cpu_usage_seconds_total{namespace="record-platform"}[5m])
```

**Memory usage by pod:**
```promql
container_memory_usage_bytes{namespace="record-platform"}
```

## Creating Custom Dashboards

### Dashboard for Your Microservices

1. Go to **Dashboards** → **New** → **New Dashboard**
2. Click **Add Visualization**
3. Select **Prometheus** datasource
4. Enter a query, for example:
   ```
   sum(rate(http_requests_total{namespace="record-platform"}[5m])) by (service)
   ```
5. Configure the panel:
   - **Panel title**: "Request Rate"
   - **Legend**: `{{service}}`
   - **Unit**: Requests/sec
6. Click **Apply** in top right
7. Click **Save dashboard** (disk icon)

### Useful Panels for Microservices

**1. Request Rate (Graph)**
```promql
sum(rate(http_requests_total{namespace="record-platform"}[5m])) by (service)
```

**2. Error Rate (Graph)**
```promql
sum(rate(http_requests_total{status=~"5..",namespace="record-platform"}[5m])) by (service)
```

**3. Response Time p95 (Graph)**
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace="record-platform"}[5m])) by (le, service))
```

**4. Response Time p99 (Graph)**
```promql
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{namespace="record-platform"}[5m])) by (le, service))
```

**5. Active Connections (Stat)**
```promql
sum(up{namespace="record-platform"}) by (service)
```

**6. Error Percentage (Gauge)**
```promql
100 * sum(rate(http_requests_total{status=~"5..",namespace="record-platform"}[5m])) by (service) / sum(rate(http_requests_total{namespace="record-platform"}[5m])) by (service)
```

**7. Top Services by Request Rate (Table)**
```promql
topk(10, sum(rate(http_requests_total{namespace="record-platform"}[5m])) by (service))
```

## Importing Pre-built Dashboards

### Kubernetes Dashboards (Already Installed)
These come with kube-prometheus-stack and are available in **Dashboards** → **Browse**.

### Custom Dashboards from ConfigMap
Dashboards defined in `infra/k8s/base/observability/grafana-dashboards.yaml` are automatically imported.

### Import from Grafana.com

1. Go to [Grafana Dashboards](https://grafana.com/grafana/dashboards/)
2. Find a dashboard (e.g., "Node Exporter Full" - ID: 1860)
3. In Grafana: **Dashboards** → **Import**
4. Enter the dashboard ID (e.g., `1860`)
5. Select Prometheus datasource
6. Click **Import**

**Recommended Dashboards:**
- **1860** - Node Exporter Full (system metrics)
- **315** - Kubernetes Cluster Monitoring
- **8588** - Kubernetes Deployment Statefulset Daemonset metrics
- **13332** - Kubernetes Pod Monitoring

## Creating Alerts

1. Go to **Alerting** → **Alert Rules** (bell icon)
2. Click **New Alert Rule**
3. Configure:
   - **Rule name**: "High Error Rate"
   - **Query**: 
     ```promql
     sum(rate(http_requests_total{status=~"5..",namespace="record-platform"}[5m])) by (service) > 10
     ```
   - **Condition**: `WHEN last() OF A IS ABOVE 10`
   - **Evaluate every**: `1m`
   - **For**: `5m`
4. Click **Save and exit**

## Linkerd Integration (if installed)

If Linkerd is installed, you can view Linkerd metrics:

1. **Linkerd Viz Dashboard**:
   ```bash
   linkerd viz dashboard
   ```
   This opens the Linkerd dashboard in your browser automatically.

2. **Linkerd Metrics in Grafana**:
   ```promql
   # Request rate from Linkerd
   sum(rate(request_total{namespace="record-platform"}[5m])) by (dst)
   
   # Success rate
   sum(rate(response_total{classification="success",namespace="record-platform"}[5m])) by (dst) / sum(rate(response_total{namespace="record-platform"}[5m])) by (dst)
   ```

## Troubleshooting

### No Metrics Showing

1. **Check if services expose metrics**:
   ```bash
   kubectl -n record-platform port-forward svc/api-gateway 4000:4000
   curl http://localhost:4000/metrics
   ```

2. **Check ServiceMonitors**:
   ```bash
   kubectl -n monitoring get servicemonitors
   kubectl -n monitoring describe servicemonitor node-services
   ```

3. **Check Prometheus Targets**:
   - Go to Prometheus UI: http://localhost:9090
   - Navigate to **Status** → **Targets**
   - Verify all services show as "UP"

### Dashboard Not Loading

1. Verify datasource is working:
   - Go to **Configuration** → **Data Sources** → **Prometheus**
   - Click **Test** button
   - Should show "Data source is working"

2. Check query syntax:
   - Use **Explore** view to test queries first
   - Verify metric names exist in Prometheus

### Can't Access Grafana

1. Check if port-forward is running:
   ```bash
   lsof -i :3000
   ```

2. Restart port-forward:
   ```bash
   pkill -f 'port-forward.*grafana'
   kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
   ```

3. Check Grafana pod status:
   ```bash
   kubectl -n monitoring get pods -l app.kubernetes.io/name=grafana
   kubectl -n monitoring logs -l app.kubernetes.io/name=grafana
   ```

## Next Steps

1. **Create service-specific dashboards** for each microservice
2. **Set up alerts** for critical metrics (error rate, latency)
3. **Configure notification channels** (Slack, email, PagerDuty)
4. **Enable Linkerd** for additional service mesh metrics
5. **Add custom business metrics** (record operations, cache hits, etc.)

## Resources

- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
- [PromQL Tutorial](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Grafana Dashboard Examples](https://grafana.com/grafana/dashboards/)
- [Linkerd Metrics Reference](https://linkerd.io/2/reference/prometheus/)

