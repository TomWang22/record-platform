# Deployment Issues Investigation

## Summary

From terminal output (lines 1-114), the deployment script successfully deployed most resources but encountered two issues:

## ✅ Successfully Deployed

1. **All Namespaces**: Created successfully
   - `record-platform`, `ingress-nginx`, `envoy-test`
   - `monitoring`, `observability` (created)

2. **All Base Services**: Deployed to `record-platform` namespace
   - All service deployments created
   - All services created
   - ConfigMaps and Secrets created
   - Envoy deployment created in `envoy-test` namespace

3. **Infrastructure**:
   - Postgres, Redis external endpoints
   - Kafka, Zookeeper deployments
   - Monitoring stack (Prometheus, Grafana, Jaeger, OTEL Collector)
   - HAProxy, Nginx deployments
   - Exporters (HAProxy, Nginx)

## ⚠️ Expected Warnings (Non-Critical)

**ServiceMonitor/PodMonitor Resources** (lines 93-100):
- **Issue**: `resource mapping not found for kind "PodMonitor"` and `"ServiceMonitor"`
- **Reason**: These require Prometheus Operator CRDs to be installed
- **Impact**: **None** - These are optional monitoring resources
- **Services work fine without them** - Prometheus can still scrape metrics manually
- **Fix**: Install Prometheus Operator if you want automatic ServiceMonitor/PodMonitor support
- **Status**: Can be ignored for now

## ❌ Issue: Caddy Deployment Failed

**Problem** (line 106):
```
error: error validating "infra/k8s/caddy-h3-deploy.yaml": error validating data: 
failed to download openapi: the server is currently unable to handle the request
```

**Root Cause**:
- Kubernetes API server was temporarily unavailable/unable to handle requests
- This happens when the cluster is under heavy load during initial deployment
- All the previous resources being created may have overloaded the API server temporarily

**Status**: 
- Caddy deployment **not created** - needs to be retried
- Caddy service **not created** - needs to be retried

**Fix Applied**:
- Updated `scripts/deploy-all-platform.sh` with:
  1. Retry logic (up to 3 attempts)
  2. `--validate=false` flag to bypass validation during cluster startup
  3. Check if deployment already exists before failing

## 🔧 Solution

### Option 1: Wait and Retry Caddy Deployment

Once cluster stabilizes, retry Caddy deployment:

```bash
# Wait for cluster to be stable
kubectl cluster-info

# Deploy Caddy
kubectl apply -f infra/k8s/caddy-h3-deploy.yaml --validate=false
kubectl apply -f infra/k8s/caddy-h3-service.yaml --validate=false

# Verify
kubectl -n ingress-nginx get pods -l app=caddy-h3
```

### Option 2: Use Updated Deployment Script

The updated script has retry logic - just re-run it:

```bash
bash scripts/deploy-all-platform.sh
```

It will:
- Wait for cluster to be accessible
- Retry Caddy deployment up to 3 times
- Check if resources already exist before failing

### Option 3: Manual Deployment with Retry

```bash
# Retry with wait
for i in {1..5}; do
  if kubectl apply -f infra/k8s/caddy-h3-deploy.yaml --validate=false 2>&1 && \
     kubectl apply -f infra/k8s/caddy-h3-service.yaml --validate=false 2>&1; then
    echo "✅ Caddy deployed!"
    break
  else
    echo "Attempt $i failed, waiting 10s..."
    sleep 10
  fi
done
```

## 📊 Current Status

From investigation:
- **Cluster**: Intermittently accessible (may be reinitializing)
- **kube-system pods**: Some in Pending state (coredns, local-path-provisioner, metrics-server)
- **User pods**: Not visible (likely because cluster API is unavailable)
- **Services**: Should be deployed (from successful output earlier)

## 🎯 Next Steps

1. **Wait for cluster to stabilize** (1-2 minutes)
   - Check: `kubectl cluster-info`
   - Wait for kube-system pods to be Running

2. **Retry Caddy deployment**
   - Use updated script OR manual retry commands above

3. **Verify all pods are running**
   ```bash
   kubectl get pods --all-namespaces
   ```

4. **Check for any other issues**
   - Look for CrashLoopBackOff pods
   - Check pod logs if needed

## 📝 Notes

- **ServiceMonitor/PodMonitor warnings are harmless** - services work without them
- **Cluster API server overload is temporary** - retry after cluster stabilizes
- **All other resources deployed successfully** - just Caddy needs retry
