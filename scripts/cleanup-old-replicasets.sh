#!/usr/bin/env bash
# Clean up old ReplicaSets that have no ready pods
# This prevents confusion when checking service readiness

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true
_kubectl() { 
  kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@" 2>/dev/null || echo ""
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

NS="record-platform"
SERVICES=("auth-service" "records-service" "listings-service" "messaging-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")

say "=== Cleaning Up Old ReplicaSets ==="

CLEANED=0
for service in "${SERVICES[@]}"; do
  # Get all ReplicaSets for this service
  rs_list=$(_kubectl get replicaset -n "$NS" -l app="$service" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.replicas}{"\t"}{.status.readyReplicas}{"\t"}{.metadata.creationTimestamp}{"\n"}{end}' 2>/dev/null || echo "")
  
  if [[ -z "$rs_list" ]]; then
    continue
  fi
  
  # Find the newest ReplicaSet (by creation timestamp)
  newest_rs=""
  newest_time=""
  while IFS=$'\t' read -r rs_name replicas ready_replicas created; do
    if [[ -z "$newest_rs" ]] || [[ "$created" > "$newest_time" ]]; then
      newest_rs="$rs_name"
      newest_time="$created"
    fi
  done <<< "$rs_list"
  
  # Scale down and delete old ReplicaSets that are not the newest
  while IFS=$'\t' read -r rs_name replicas ready_replicas created; do
    if [[ "$rs_name" != "$newest_rs" ]] && [[ "${replicas:-0}" != "0" ]]; then
      echo "  Scaling down old ReplicaSet: $rs_name (replicas: $replicas, created: $created)"
      _kubectl scale replicaset "$rs_name" -n "$NS" --replicas=0 --request-timeout=10s >/dev/null 2>&1 || true
      sleep 1
      echo "  Deleting old ReplicaSet: $rs_name"
      _kubectl delete replicaset "$rs_name" -n "$NS" --request-timeout=10s >/dev/null 2>&1 && ((CLEANED++)) || true
    elif [[ "$rs_name" != "$newest_rs" ]] && [[ "${ready_replicas:-0}" == "0" ]]; then
      echo "  Deleting old ReplicaSet: $rs_name (0 ready, created: $created)"
      _kubectl delete replicaset "$rs_name" -n "$NS" --request-timeout=10s >/dev/null 2>&1 && ((CLEANED++)) || true
    fi
  done <<< "$rs_list"
done

if [[ $CLEANED -gt 0 ]]; then
  ok "Cleaned up $CLEANED old ReplicaSet(s)"
else
  ok "No old ReplicaSets to clean up"
fi

# Also clean up any pods that are not ready and belong to old ReplicaSets
say "=== Cleaning Up Old Stuck Pods ==="

PODS_CLEANED=0
for service in "${SERVICES[@]}"; do
  # Get all pods for this service
  pods=$(_kubectl get pods -n "$NS" -l app="$service" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.ownerReferences[0].name}{"\t"}{.status.containerStatuses[0].ready}{"\t"}{.metadata.creationTimestamp}{"\n"}{end}' 2>/dev/null || echo "")
  
  if [[ -z "$pods" ]]; then
    continue
  fi
  
  # Find the newest pod's ReplicaSet
  newest_rs=""
  newest_time=""
  while IFS=$'\t' read -r pod_name rs_name ready created; do
    if [[ -z "$newest_rs" ]] || [[ "$created" > "$newest_time" ]]; then
      newest_rs="$rs_name"
      newest_time="$created"
    fi
  done <<< "$pods"
  
  # Delete pods that belong to old ReplicaSets and are not ready
  while IFS=$'\t' read -r pod_name rs_name ready created; do
    if [[ "$rs_name" != "$newest_rs" ]] && [[ "$ready" != "true" ]]; then
      echo "  Deleting old pod: $pod_name (ReplicaSet: $rs_name, ready: $ready)"
      _kubectl delete pod "$pod_name" -n "$NS" --request-timeout=10s >/dev/null 2>&1 && ((PODS_CLEANED++)) || true
    fi
  done <<< "$pods"
done

if [[ $PODS_CLEANED -gt 0 ]]; then
  ok "Cleaned up $PODS_CLEANED old pod(s)"
else
  ok "No old pods to clean up"
fi

say "=== Cleanup Complete ==="
