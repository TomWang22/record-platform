#!/usr/bin/env bash
set -euo pipefail

# Fix Kafka Cluster ID mismatch issue
# This happens when Zookeeper cluster ID changes but Kafka still has old cluster ID in meta.properties

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

NS="record-platform"

say "=== Fixing Kafka Cluster ID Mismatch ==="

# Step 1: Check if Kafka pod exists
KAFKA_POD=$(kubectl get pods -n "$NS" -l app=kafka -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$KAFKA_POD" ] || [ "$KAFKA_POD" == "null" ]; then
  fail "Kafka pod not found"
  exit 1
fi

say "Step 1: Checking Kafka error..."
KAFKA_LOGS=$(kubectl logs -n "$NS" "$KAFKA_POD" --tail=100 2>&1 || echo "")
if echo "$KAFKA_LOGS" | grep -q "InconsistentClusterIdException"; then
  warn "Cluster ID mismatch detected"
  echo "Error: $(echo "$KAFKA_LOGS" | grep -A 2 "InconsistentClusterIdException" | head -3)"
else
  ok "No Cluster ID mismatch in current logs"
  say "Checking if Kafka is running..."
  STATUS=$(kubectl get pod "$KAFKA_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>&1 || echo "Unknown")
  if [ "$STATUS" == "Running" ]; then
    READY=$(kubectl get pod "$KAFKA_POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>&1 || echo "false")
    if [ "$READY" == "true" ]; then
      ok "Kafka is already running and ready"
      exit 0
    fi
  fi
fi

# Step 2: Check Zookeeper status
say "Step 2: Checking Zookeeper status..."
ZOOKEEPER_POD=$(kubectl get pods -n "$NS" -l app=zookeeper -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$ZOOKEEPER_POD" ] || [ "$ZOOKEEPER_POD" == "null" ]; then
  fail "Zookeeper pod not found"
  exit 1
fi

ZOOKEEPER_STATUS=$(kubectl get pod "$ZOOKEEPER_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>&1 || echo "Unknown")
if [ "$ZOOKEEPER_STATUS" != "Running" ]; then
  fail "Zookeeper is not Running (status: $ZOOKEEPER_STATUS)"
  exit 1
fi
ok "Zookeeper is Running"

# Step 3: Delete Kafka pod to clear data
say "Step 3: Deleting Kafka pod to clear cluster ID mismatch..."
kubectl delete pod "$KAFKA_POD" -n "$NS"
ok "Kafka pod deleted"

# Step 4: Wait for new pod to be created
say "Step 4: Waiting for new Kafka pod..."
sleep 10
NEW_KAFKA_POD=$(kubectl get pods -n "$NS" -l app=kafka -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$NEW_KAFKA_POD" ] || [ "$NEW_KAFKA_POD" == "null" ]; then
  fail "New Kafka pod not found after deletion"
  exit 1
fi
ok "New Kafka pod created: $NEW_KAFKA_POD"

# Step 5: Wait for Kafka to start
say "Step 5: Waiting for Kafka to start (this may take 1-2 minutes)..."
for i in {1..30}; do
  sleep 5
  STATUS=$(kubectl get pod "$NEW_KAFKA_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>&1 || echo "Unknown")
  READY=$(kubectl get pod "$NEW_KAFKA_POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>&1 || echo "false")
  
  if [ "$STATUS" == "Running" ] && [ "$READY" == "true" ]; then
    ok "Kafka is Running and Ready!"
    break
  fi
  
  # Check for errors
  ERROR=$(kubectl logs -n "$NS" "$NEW_KAFKA_POD" --tail=20 2>&1 | grep -i "InconsistentClusterIdException\|Fatal\|ERROR" || echo "")
  if [ -n "$ERROR" ]; then
    warn "Error detected in logs:"
    echo "$ERROR"
    if echo "$ERROR" | grep -q "InconsistentClusterIdException"; then
      warn "Cluster ID mismatch still present. May need to clear Zookeeper data or use a persistent volume."
      say "Alternative fix: Delete and recreate Kafka deployment"
      echo "  kubectl delete deployment kafka -n $NS"
      echo "  kubectl apply -f infra/k8s/base/kafka/deploy.yaml"
      exit 1
    fi
  fi
  
  echo "  Attempt $i/30: Status=$STATUS, Ready=$READY"
done

# Step 6: Final status check
say "Step 6: Final status check..."
FINAL_STATUS=$(kubectl get pod "$NEW_KAFKA_POD" -n "$NS" -o jsonpath='{.status.phase}' 2>&1 || echo "Unknown")
FINAL_READY=$(kubectl get pod "$NEW_KAFKA_POD" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>&1 || echo "false")

if [ "$FINAL_STATUS" == "Running" ] && [ "$FINAL_READY" == "true" ]; then
  ok "Kafka is healthy!"
  say "Kafka pod: $NEW_KAFKA_POD"
  say "Status: $FINAL_STATUS"
  say "Ready: $FINAL_READY"
else
  warn "Kafka is not fully ready yet"
  say "Status: $FINAL_STATUS"
  say "Ready: $FINAL_READY"
  say "Check logs: kubectl logs -n $NS $NEW_KAFKA_POD"
fi

