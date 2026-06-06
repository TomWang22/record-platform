#!/usr/bin/env bash
# Remove legacy spec.loadBalancerIP from kafka-*-external (MetalLB allocator assigns IPs; OCH cold-bootstrap pattern).
set -euo pipefail

NS="${HOUSING_NS:-record-platform}"
REP="${KAFKA_BROKER_REPLICAS:-3}"

echo "=== strip spec.loadBalancerIP from kafka-*-external (ns=$NS replicas=$REP) ==="
for ((i = 0; i < REP; i++)); do
  svc="kafka-${i}-external"
  if ! kubectl get svc "$svc" -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
    echo "  (no $svc — skip)"
    continue
  fi
  if kubectl get svc "$svc" -n "$NS" -o jsonpath='{.spec.loadBalancerIP}' --request-timeout=10s 2>/dev/null | grep -q .; then
    kubectl patch svc "$svc" -n "$NS" --type=LoadBalancer -p '{"spec":{"loadBalancerIP":null}}' 2>/dev/null || true
    echo "  stripped spec.loadBalancerIP on $svc"
  else
    echo "  (no spec.loadBalancerIP on $svc)"
  fi
done
echo "✅ strip complete"
