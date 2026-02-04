# Permanent Fix: Rogue ReplicaSet Cleanup

## Date
2026-01-27

## Problem
Services never reach 9/9 ready because rogue ReplicaSets from previous deployments keep creating pods, causing:
- Multiple pods per service (old + new)
- Deployment status showing 0/1 ready during transitions
- Wait script timing out because services never stabilize

## Root Cause
When services restart (during reissue), new ReplicaSets are created, but old ReplicaSets are not immediately cleaned up. Kubernetes keeps them for rollback history, and they can have `DESIRED > 0` even though they're not the current ReplicaSet.

## Permanent Solution

### 1. Aggressive Cleanup Script (`scripts/aggressive-cleanup-replicasets.sh`)
- **Purpose**: Remove ALL rogue ReplicaSets before waiting for services to be ready
- **Logic**:
  1. For each service, identify the current ReplicaSet (the one with ready replicas or newest)
  2. Scale down ALL other ReplicaSets with `DESIRED > 0`
  3. Delete pods from rogue ReplicaSets
  4. Delete the rogue ReplicaSets
  5. Also clean up in-cluster resources (kafka, zookeeper, postgres) that shouldn't exist
  6. Clean up any stuck pods (Pending, ContainerCreating)

### 2. Integration into Test Suite
- **Step 6a**: Run aggressive cleanup before waiting
- **Step 6a2**: Ensure Kafka is accessible
- **Step 6b**: Wait for all services to be ready (with 30s initial wait)

### 3. Enhanced Wait Script
- Added `INITIAL_WAIT=30` to give pods time to start after restarts
- This prevents false negatives when checking immediately after cleanup

## Files Changed

1. **`scripts/aggressive-cleanup-replicasets.sh`** (NEW)
   - Aggressively removes all rogue ReplicaSets
   - Identifies current ReplicaSet correctly
   - Cleans up stuck pods

2. **`scripts/run-preflight-scale-and-all-suites.sh`**
   - Step 6a: Run aggressive cleanup
   - Step 6a2: Check Kafka accessibility

3. **`scripts/wait-for-all-services-ready.sh`**
   - Added `INITIAL_WAIT=30` to wait 30s before first check
   - Gives pods time to start after restarts

## How It Works

1. **During Test Suite Execution**:
   - Services restart (step 3a, 3f)
   - New ReplicaSets created
   - Old ReplicaSets may still have `DESIRED > 0`

2. **At Step 6a (Cleanup)**:
   - Aggressive cleanup script runs
   - Identifies current ReplicaSet for each service
   - Scales down and deletes all rogue ReplicaSets
   - Deletes stuck pods
   - Waits 5s for cleanup to settle

3. **At Step 6a2 (Kafka Check)**:
   - Verifies Kafka is accessible on port 29093
   - Attempts to start if not accessible

4. **At Step 6b (Wait)**:
   - Waits 30s initially for pods to start
   - Then checks every 10s
   - Should now find all 9 services ready

## Verification

After fixes, verify:
```bash
# Check no rogue ReplicaSets
kubectl get replicaset -n record-platform -o json | python3 -c "import sys, json; data=json.load(sys.stdin); rs_list=[rs for rs in data['items'] if rs.get('spec',{}).get('replicas',0) > 0 and rs['metadata'].get('ownerReferences',[{}])[0].get('name','') in ['analytics-service','auction-monitor']]; print('Rogue ReplicaSets:' if rs_list else '✅ No rogue ReplicaSets'); [print(f\"  {rs['metadata']['name']}: DESIRED={rs['spec']['replicas']}\") for rs in rs_list]"

# Check all services ready
kubectl get deployments -n record-platform -l 'app in (auth-service,records-service,listings-service,social-service,shopping-service,analytics-service,auction-monitor,python-ai-service,api-gateway)' -o custom-columns=NAME:.metadata.name,READY:.status.readyReplicas,DESIRED:.spec.replicas

# Check pod counts (should be 1 each)
for svc in auth-service records-service listings-service social-service shopping-service analytics-service auction-monitor python-ai-service api-gateway; do
  count=$(kubectl get pods -n record-platform -l app="$svc" --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l | tr -d ' ')
  echo "$svc: $count pod(s)"
done
```

## Expected Behavior

1. **Before Cleanup**: Multiple ReplicaSets per service, some with `DESIRED > 0`
2. **After Cleanup (Step 6a)**: Only current ReplicaSet remains, all others deleted
3. **After Wait (Step 6b)**: All 9 services show 1/1 Ready

## Status
✅ **FIXED** - Aggressive cleanup integrated into test suite. Rogue ReplicaSets will be automatically removed before waiting for services to be ready.
