#!/usr/bin/env bash
# Expose Ollama on MetalLB :11434 (host/laptop). In-cluster DNS `ollama` stays ClusterIP.
set -euo pipefail
NS="${HOUSING_NS:-record-platform}"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ollama-lb
  namespace: ${NS}
  labels:
    app: ollama
  annotations:
    metallb.universe.tf/address-pool: record-platform-pool
spec:
  type: LoadBalancer
  allocateLoadBalancerNodePorts: false
  selector:
    app: ollama
  ports:
    - name: http
      port: 11434
      targetPort: 11434
      protocol: TCP
EOF
ip="$(kubectl get svc -n "$NS" ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
echo "✅ service/ollama-lb applied${ip:+ — MetalLB IP=${ip}}"
