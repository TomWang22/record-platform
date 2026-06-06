#!/usr/bin/env bash
# Test gRPC directly to a service (no Envoy). Use to verify service TLS before debugging Envoy.
# Usage:
#   ./scripts/test-grpc-direct-in-cluster.sh [auth-service|records-service|...]
# Default: auth-service. Requires dev-root-ca in cluster and grpcurl in a pod.
# Example (from host, run a one-off pod):
#   kubectl run grpc-direct --rm -it -n record-platform --image=fullstorydev/grpcurl -- \
#     grpcurl -cacert /path/to/dev-root.pem auth-service.record-platform.svc.cluster.local:50051 grpc.health.v1.Health/Check
#
# This script runs that pod with CA from the cluster secret so you don't need the path on host.

set -e
SVC="${1:-auth-service}"
NS="${NAMESPACE:-record-platform}"
CA_SECRET_NAME="${CA_SECRET_NAME:-dev-root-ca}"
CA_KEY="${CA_KEY:-dev-root.pem}"

# Ensure secret exists in target namespace (sync from ingress-nginx if needed)
if ! kubectl get secret -n "$NS" "$CA_SECRET_NAME" &>/dev/null; then
  echo "Syncing $CA_SECRET_NAME from ingress-nginx to $NS..."
  kubectl get secret -n ingress-nginx "$CA_SECRET_NAME" -o yaml | \
    sed "s/namespace: ingress-nginx/namespace: $NS/" | \
    kubectl apply -f - 2>/dev/null || true
fi

# Run grpcurl in a pod with CA mounted from secret. Service DNS: <svc>.<ns>.svc.cluster.local
case "$SVC" in
  auth-service)     PORT=50051 ;;
  records-service)  PORT=50051 ;;
  social-service)   PORT=50056 ;;
  listings-service) PORT=50057 ;;
  analytics-service) PORT=50054 ;;
  shopping-service) PORT=50058 ;;
  auction-monitor)  PORT=50059 ;;
  python-ai-service) PORT=50060 ;;
  *) echo "Unknown service: $SVC"; exit 1 ;;
esac

HOST="${SVC}.${NS}.svc.cluster.local"
echo "Testing gRPC direct (no Envoy): $HOST:$PORT grpc.health.v1.Health/Check"
kubectl run "grpc-direct-$$" --rm -it --restart=Never -n "$NS" \
  --image=fullstorydev/grpcurl \
  --overrides="$(cat <<EOF
{
  "spec": {
    "containers": [{
      "name": "grpc-direct",
      "image": "fullstorydev/grpcurl",
      "command": ["grpcurl", "-cacert", "/etc/certs/dev-root.pem", "-max-time", "10", "$HOST:$PORT", "grpc.health.v1.Health/Check"],
      "volumeMounts": [{ "name": "ca", "mountPath": "/etc/certs", "readOnly": true }]
    }],
    "volumes": [{
      "name": "ca",
      "secret": { "secretName": "$CA_SECRET_NAME", "items": [{ "key": "$CA_KEY", "path": "dev-root.pem" }] }
    }]
  }
}
EOF
)" 2>/dev/null || true

# Fallback: if --overrides not supported or fails, print manual command
echo ""
echo "Manual (copy CA into a pod first):"
echo "  grpcurl -cacert /etc/certs/dev-root.pem -max-time 10 $HOST:$PORT grpc.health.v1.Health/Check"
