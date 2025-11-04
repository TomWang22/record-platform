# file: scripts/apply-gateway-and-ingress.sh
#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="infra/k8s/base/api-gateway"
OVERLAY_ING="infra/k8s/overlays/dev/ingress.yaml"
NS="record-platform"

# Sanity checks
[[ -d "$BASE_DIR" ]] || { echo "ERR: missing $BASE_DIR"; exit 1; }
[[ -f "$OVERLAY_ING" ]] || { echo "ERR: missing $OVERLAY_ING"; exit 1; }
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS"

echo "== Applying base api-gateway kustomize =="
kubectl apply -k "$BASE_DIR"

echo "== Waiting for api-gateway rollout =="
kubectl -n "$NS" rollout status deploy/api-gateway

echo "== Applying updated Ingress =="
kubectl apply -f "$OVERLAY_ING"

echo "== Quick checks =="
kubectl -n "$NS" get svc,ep api-gateway -o wide
kubectl -n "$NS" get ingress record-platform -o wide