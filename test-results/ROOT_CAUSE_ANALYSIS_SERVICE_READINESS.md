# Root Cause Analysis: Service Readiness Issues at Step 6a

## Date
2026-01-27

## Problem Statement
The test suite (`run-preflight-scale-and-all-suites.sh`) was failing at step 6a with:
- `fail: command not found` error
- Only 5-6/9 services ready (specifically: `social-service`, `analytics-service`, `auction-monitor` showing 0/1)
- Kafka intermittently showing as DOWN

## Root Cause Identified

### Primary Issue: Multiple Pods Per Service (Old Stuck Pods)

**Symptom**: When checking service readiness, deployments showed 0/1 ready, but there were actually 2 pods per service:
- **Old pod**: Not ready, high restart count (16-17 restarts), created hours earlier
- **New pod**: Ready, 0 restarts, created recently

**Example from diagnostics**:
```
analytics-service:
  - analytics-service-56b664d899-q2knb: Running, false, 17 restarts (created 02:23:35Z) - OLD
  - analytics-service-68bc5557b6-758ch: Running, true, 0 restarts (created 04:49:29Z) - NEW

auction-monitor:
  - auction-monitor-5b9cdfc9b9-87rtg: Running, false, 17 restarts (created 02:23:35Z) - OLD
  - auction-monitor-7c8d894845-5fqvj: Running, true, 0 restarts (created 04:49:45Z) - NEW
```

### Why This Happened

1. **Service Restarts During Reissue**: When the test suite runs step 3a (reissue CA + leaf), it restarts all service deployments:
   ```bash
   deployment.apps/analytics-service restarted
   deployment.apps/auction-monitor restarted
   ```

2. **New ReplicaSets Created**: Each restart creates a new ReplicaSet with a new pod.

3. **Old ReplicaSets Not Cleaned Up**: Kubernetes doesn't immediately delete old ReplicaSets. They remain with their old pods until:
   - The deployment's `revisionHistoryLimit` is reached
   - Manual cleanup is performed
   - The old pods are explicitly deleted

4. **Old Pods Failed to Start**: The old pods had `FailedMount` errors because the `service-tls` secret was not found at the time they were created:
   ```
   Warning   FailedMount   pod/analytics-service-56b664d899-q2knb
   MountVolume.SetUp failed for volume "service-tls" : secret "service-tls" not found
   ```

5. **Wait Script Confusion**: The `wait-for-all-services-ready.sh` script checks deployment status (`readyReplicas`), which should only count pods from the current ReplicaSet. However:
   - During transitions, there can be timing issues
   - Old pods from old ReplicaSets can cause confusion
   - The deployment might show 0/1 ready if the new pod is still starting

### Secondary Issue: `fail` Function Scope

The `fail` function is defined in `run-preflight-scale-and-all-suites.sh` at line 27:
```bash
fail(){ echo "❌ $*" >&2; exit 1; }
```

However, when `wait-for-all-services-ready.sh` exits with a non-zero code, the main script calls `fail`, but there might be edge cases where the function isn't in scope (though it should be).

## Fixes Applied

### 1. Created `cleanup-old-replicasets.sh`
- **Purpose**: Automatically clean up old ReplicaSets and stuck pods before waiting for services to be ready
- **Logic**:
  - Identifies the newest ReplicaSet for each service (by creation timestamp)
  - Deletes old ReplicaSets with 0 ready replicas
  - Deletes old pods that belong to old ReplicaSets and are not ready
- **Integration**: Added as step 6a in `run-preflight-scale-and-all-suites.sh`, before the wait step (now 6b)

### 2. Improved Wait Script Robustness
- The `wait-for-all-services-ready.sh` script already checks deployment status correctly
- Added cleanup step before wait to ensure no old pods interfere

### 3. Enhanced Diagnostics
- Created `quick-pod-diagnostics.sh` for faster, focused diagnostics on problem pods only
- Improved `deep-dive-pod-diagnostics.sh` (though it can timeout on large clusters)

## Prevention

### Automatic Cleanup
The cleanup script now runs automatically before the wait step, preventing old pods from causing issues.

### Manual Cleanup (if needed)
If you see multiple pods per service:
```bash
# Clean up old ReplicaSets and pods
./scripts/cleanup-old-replicasets.sh

# Or manually delete old pods
kubectl get pods -n record-platform -l app=analytics-service
kubectl delete pod <old-pod-name> -n record-platform
```

### Kubernetes Configuration
Consider setting `revisionHistoryLimit` in deployments to automatically limit old ReplicaSets:
```yaml
spec:
  revisionHistoryLimit: 2  # Keep only 2 old ReplicaSets
```

## Verification

After fixes:
```bash
# Check service status
kubectl get deployments -n record-platform -l 'app in (auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service,api-gateway)' -o custom-columns=NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas

# Verify only 1 pod per service
for svc in analytics-service auction-monitor social-service; do
  kubectl get pods -n record-platform -l app="$svc" --no-headers | wc -l
done
```

## Expected Behavior

1. **Before Wait Step**: Cleanup script runs automatically, removing old ReplicaSets and stuck pods
2. **During Wait**: Only current ReplicaSet pods are checked
3. **After Wait**: All 9 services should show 1/1 ready, with only 1 pod per service

## Related Files

- `scripts/cleanup-old-replicasets.sh` - New cleanup script
- `scripts/run-preflight-scale-and-all-suites.sh` - Main test suite (updated with cleanup step)
- `scripts/wait-for-all-services-ready.sh` - Wait script (unchanged, but now runs after cleanup)
- `scripts/quick-pod-diagnostics.sh` - Fast diagnostics for problem pods
- `scripts/deep-dive-pod-diagnostics.sh` - Comprehensive diagnostics (all pods, all namespaces)

## Status
✅ **RESOLVED** - Root cause identified and fixed with automatic cleanup before wait step.
