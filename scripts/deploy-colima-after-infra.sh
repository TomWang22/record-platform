#!/usr/bin/env bash
# Run after: bring-up-external-infra.sh, ensure-external-databases-created.sh, setup-metallb-and-namespaces.sh.
# Base apply requires certs/ (record.local.crt, record.local.key, dev-root.pem) for TLS secrets; create with ./scripts/strict-tls-bootstrap.sh or ensure certs/ exist before running.
# 1) Installs Prometheus Operator CRDs so base apply does not fail on ServiceMonitors.
# 2) Applies infra/k8s/base.
# 3) Builds app :dev images on Colima (build-colima-dev-images.sh).
# 4) Ensures Caddy TLS in ingress-nginx (copy from record-platform if present), then rolls out Caddy with LoadBalancer.
# Usage: ./scripts/deploy-colima-after-infra.sh
# Optional: SKIP_CRDS=1 to skip CRD install; SKIP_BASE=1 to skip base apply; SKIP_IMAGES=1 to skip image build; SKIP_CADDY=1 to skip Caddy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS_ING="ingress-nginx"
NS_RP="record-platform"

# 1) Install Prometheus Operator CRDs so ServiceMonitor apply succeeds
if [[ "${SKIP_CRDS:-0}" != "1" ]] && [[ -x "$SCRIPT_DIR/install-prometheus-operator-crds.sh" ]]; then
  echo "=== Installing Prometheus Operator CRDs (ServiceMonitor/PodMonitor) ==="
  "$SCRIPT_DIR/install-prometheus-operator-crds.sh" || true
fi

# 2) Apply base k8s
if [[ "${SKIP_BASE:-0}" != "1" ]]; then
  echo "=== Applying infra/k8s/base ==="
  kubectl apply -k infra/k8s/base --request-timeout=60s
fi

# 3) Build :dev images on Colima so app pods can start
if [[ "${SKIP_IMAGES:-0}" != "1" ]] && [[ -x "$SCRIPT_DIR/build-colima-dev-images.sh" ]]; then
  echo "=== Building Colima :dev images ==="
  "$SCRIPT_DIR/build-colima-dev-images.sh"
fi

# 4) Caddy: ensure TLS secrets in ingress-nginx (copy from record-platform if base created them there)
if [[ "${SKIP_CADDY:-0}" != "1" ]]; then
  echo "=== Ensuring Caddy TLS in $NS_ING ==="
  kubectl create namespace "$NS_ING" --dry-run=client -o yaml | kubectl apply -f -

  if ! kubectl -n "$NS_ING" get secret record-local-tls &>/dev/null; then
    if kubectl -n "$NS_RP" get secret service-tls &>/dev/null; then
      echo "  Copying service-tls from $NS_RP to $NS_ING as record-local-tls"
      kubectl get secret service-tls -n "$NS_RP" -o json | \
        jq -r 'del(.metadata.namespace,.metadata.resourceVersion,.metadata.uid,.metadata.creationTimestamp,.metadata.selfLink) | .metadata.name="record-local-tls"' | \
        kubectl apply -n "$NS_ING" -f -
    else
      echo "  Run ./scripts/strict-tls-bootstrap.sh (requires certs in ./certs/) then re-run this script to deploy Caddy."
      echo "  Or create record-local-tls and dev-root-ca in $NS_ING manually."
      exit 1
    fi
  fi
  if ! kubectl -n "$NS_ING" get secret dev-root-ca &>/dev/null; then
    if kubectl -n "$NS_RP" get secret dev-root-ca &>/dev/null; then
      echo "  Copying dev-root-ca from $NS_RP to $NS_ING"
      kubectl get secret dev-root-ca -n "$NS_RP" -o json | \
        jq -r 'del(.metadata.namespace,.metadata.resourceVersion,.metadata.uid,.metadata.creationTimestamp,.metadata.selfLink)' | \
        kubectl apply -n "$NS_ING" -f -
    else
      echo "  Run ./scripts/strict-tls-bootstrap.sh (requires certs in ./certs/) then re-run this script to deploy Caddy."
      exit 1
    fi
  fi

  echo "=== Rolling out Caddy (LoadBalancer) ==="
  CADDY_USE_LOADBALANCER=1 "$SCRIPT_DIR/rollout-caddy.sh"
fi

echo "Done. Check: kubectl get pods -n record-platform; kubectl get svc -n ingress-nginx"
