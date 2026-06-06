#!/usr/bin/env bash
set -euo pipefail

# k6 Shopping Service Limit Test Runner
# Runs k6 ramp-up test to find the upper bound of shopping service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_SCRIPT="${SCRIPT_DIR}/load/k6-shopping-ramp.js"

# Configuration
SHOPPING_URL="${SHOPPING_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"
AUTH_URL="${AUTH_URL:-https://caddy-h3.ingress-nginx.svc.cluster.local:443}"
HOST="${HOST:-record.local}"

# Get Caddy service ClusterIP for hostAliases
CADDY_CLUSTER_IP=$(kubectl get svc caddy-h3 -n ingress-nginx --context kind-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")

if [ -z "$CADDY_CLUSTER_IP" ]; then
  echo "❌ Could not get Caddy service ClusterIP"
  exit 1
fi

echo "🚀 Running k6 shopping service limit test"
echo "   Shopping URL: ${SHOPPING_URL}"
echo "   Auth URL: ${AUTH_URL}"
echo "   Host: ${HOST}"
echo "   Caddy ClusterIP: ${CADDY_CLUSTER_IP}"
echo ""

# Create ConfigMap for k6 script
kubectl create configmap k6-shopping-ramp-script \
  --from-file=k6-shopping-ramp.js="${K6_SCRIPT}" \
  -n record-platform \
  --context kind-h3 \
  --dry-run=client -o yaml | kubectl apply -f -

# Create Job manifest
cat <<EOF | kubectl apply -f - --context kind-h3
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-shopping-limit-test
  namespace: record-platform
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      hostAliases:
      - ip: ${CADDY_CLUSTER_IP}
        hostnames:
        - record.local
        - caddy-h3.ingress-nginx.svc.cluster.local
      containers:
      - name: k6
        image: grafana/k6:latest
        command: ["k6", "run", "/scripts/k6-shopping-ramp.js"]
        env:
        - name: SHOPPING_URL
          value: "${SHOPPING_URL}"
        - name: AUTH_URL
          value: "${AUTH_URL}"
        - name: HOST
          value: "${HOST}"
        - name: SSL_CERT_FILE
          value: "/etc/ssl/certs/ca-certificates.crt"
        - name: NODE_EXTRA_CA_CERTS
          value: "/certs/dev-root.pem"
        volumeMounts:
        - name: k6-script
          mountPath: /scripts
        - name: dev-root-ca
          mountPath: /certs
          readOnly: true
      volumes:
      - name: k6-script
        configMap:
          name: k6-shopping-ramp-script
          defaultMode: 0755
      - name: dev-root-ca
        secret:
          secretName: dev-root-ca
          items:
          - key: dev-root.pem
            path: dev-root.pem
      restartPolicy: Never
EOF

echo ""
echo "⏳ Waiting for k6 job to complete..."
kubectl wait --for=condition=complete --timeout=30m job/k6-shopping-limit-test -n record-platform --context kind-h3 || true

echo ""
echo "📊 k6 Test Results:"
kubectl logs job/k6-shopping-limit-test -n record-platform --context kind-h3

echo ""
echo "🧹 Cleaning up..."
kubectl delete job k6-shopping-limit-test -n record-platform --context kind-h3 --ignore-not-found=true
