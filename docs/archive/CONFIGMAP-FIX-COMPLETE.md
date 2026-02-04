# ConfigMap Fix Complete

## Issue
Pods were failing to mount volumes with error:
- `MountVolume.SetUp failed for volume "proto-files" : object "record-platform"/"proto-files" not registered`
- `MountVolume.SetUp failed for volume "dev-root-ca" : object "record-platform"/"dev-root-ca" not registered`

## Root Cause
After k3s restart, it lost track of existing ConfigMaps/Secrets in its internal registry. The objects existed but were "not registered" in k3s's watch list.

## Solution
1. **Recreated proto-files ConfigMap** from the proto/ directory:
   ```bash
   kubectl create configmap proto-files -n record-platform \
     --from-file=proto/ --dry-run=client -o yaml | kubectl apply -f -
   ```
2. **Updated annotations** on dev-root-ca Secret to force re-registration
3. **Pod restarts** picked up the volumes correctly

## Result
✅ **proto-files ConfigMap** - Recreated with all 9 proto files:
- auth.proto
- health.proto  
- records.proto
- listings.proto
- social.proto
- shopping.proto
- analytics.proto
- auction-monitor.proto
- python-ai.proto

✅ **Services now running**:
- listings-service: Running, Ready
- records-service: Running, Ready
- auth-service: Starting up

## Proto File Locations
We have proto files in two locations:
1. `/proto/` - Main proto directory (used for ConfigMap)
2. `/infra/k8s/base/config/proto/` - K8s config proto directory

Both are kept in sync and contain the same files. The ConfigMap is created from `/proto/` directory.

## Script Available
`scripts/sync-proto-to-k8s.sh` - Script to sync proto files to K8s ConfigMap

## Status
✅ ConfigMap issue resolved
✅ Pods can mount volumes
✅ Services starting successfully
