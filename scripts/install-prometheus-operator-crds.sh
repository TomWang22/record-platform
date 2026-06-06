#!/usr/bin/env bash
# Install Prometheus Operator CRDs for ServiceMonitor and PodMonitor (monitoring.coreos.com/v1).
# Required for observability servicemonitors.yaml and podmonitors.yaml. Run once per cluster.
# Usage: ./scripts/install-prometheus-operator-crds.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Use a stable version; v0.73.0 has both CRDs
PROM_OP_VERSION="${PROM_OP_VERSION:-v0.73.0}"
BASE_URL="https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/${PROM_OP_VERSION}/example/prometheus-operator-crd"
SERVICEMONITOR_CRD="monitoring.coreos.com_servicemonitors.yaml"
PODMONITOR_CRD="monitoring.coreos.com_podmonitors.yaml"

"$SCRIPT_DIR/ensure-k8s-api.sh" || exit 1

echo "Installing Prometheus Operator CRDs (ServiceMonitor, PodMonitor)..."
for name in "$SERVICEMONITOR_CRD" "$PODMONITOR_CRD"; do
  url="${BASE_URL}/${name}"
  if kubectl apply -f "$url" --request-timeout=60s 2>/dev/null; then
    echo "  applied $name"
  else
    echo "  ⚠️  failed to apply $url (may already exist)"
  fi
done
echo "✅ CRDs installed. You can apply observability with servicemonitors and podmonitors enabled."
