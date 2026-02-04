# Pod Startup Issues Analysis

## 🔍 Root Causes Identified

### 1. **Missing Docker Images** (8 services - CRITICAL)
**Status**: `ErrImageNeverPull` - Images use `imagePullPolicy: Never` but are not loaded in cluster

**Affected Services:**
- analytics-service:dev
- api-gateway:dev
- auction-monitor:dev
- auth-service:dev
- listings-service:dev
- records-service:dev
- social-service:dev
- shopping-service:dev (also has ImagePullBackOff)

**Solution Required:**
- Build Docker images for all services
- Load them into the Colima cluster using `docker load` or `kind load docker-image`
- OR change `imagePullPolicy` from `Never` to `IfNotPresent` and push to a registry

### 2. **Missing ConfigMaps** (FIXED)
- ✅ `caddy-h3` ConfigMap: Created from Caddyfile
- ✅ `app-config` ConfigMap: Need to verify/apply from kustomize

### 3. **Resource Constraints**
- **Memory**: 99% allocated (11.9GB/12GB)
- **CPU**: 37% allocated (4.5 cores/12 cores)
- This may cause scheduling delays for new pods

### 4. **Other Issues**
- `python-ai-service`: Missing `app-config` ConfigMap
- `zookeeper`: Pending (likely waiting for resources or dependencies)
- `kafka`: PodInitializing (still starting)

## 🎯 Immediate Actions Needed

1. **Build and Load Docker Images** (Highest Priority)
   ```bash
   # Build all service images
   # Load them into Colima/Docker
   # OR change imagePullPolicy in deployments
   ```

2. **Verify ConfigMaps Created**
   - Confirm `caddy-h3` exists in `ingress-nginx` namespace
   - Confirm `app-config` exists in `record-platform` namespace

3. **Monitor Resource Usage**
   - Consider reducing memory limits if pods can't be scheduled
   - Wait for current pods to stabilize before adding more

## 📊 Current Pod Status

- **Running**: 13 pods (system + observability)
- **Pending/Stuck**: 13 pods (waiting for images/ConfigMaps)
- **ContainerCreating**: 2 pods (Caddy - waiting for ConfigMap)
- **PodInitializing**: 1 pod (kafka)
