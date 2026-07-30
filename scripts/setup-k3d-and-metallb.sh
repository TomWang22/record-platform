#!/usr/bin/env bash
# One-shot setup: get k3d cluster ready, workloads applied, images in registry, MetalLB installed.
#
# Breakdown: (1) Checks Docker and k3d cluster exist; merges kubeconfig. (2) Optionally applies infra/k8s/base
# (SKIP_BASE=1 to skip). (3) Optionally runs k3d-registry-push-and-patch.sh to push :dev images and patch
# deployments (SKIP_REGISTRY=1 to skip). (4) Optionally installs MetalLB with pool from METALLB_POOL or k3d network (SKIP_METALLB=1 to skip). (5) Waits for record-platform pods (SKIP_POD_WAIT=1 to skip). Run after Docker and ports 6443/55617 free (Runbook #53).
#
# Usage: ./scripts/setup-k3d-and-metallb.sh [cluster-name]
#   SKIP_BASE=1        skip kubectl apply -k base (already applied)
#   SKIP_REGISTRY=1    skip registry push and deploy patch (images already in registry)
#   SKIP_METALLB=1     skip MetalLB install
#   SKIP_POD_WAIT=1    skip waiting for pods to be ready
#
# Order: Docker up → k3d cluster up → this script → preflight when ready.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER="${1:-record-platform}"
SKIP_BASE="${SKIP_BASE:-0}"
SKIP_REGISTRY="${SKIP_REGISTRY:-0}"
SKIP_METALLB="${SKIP_METALLB:-0}"
SKIP_POD_WAIT="${SKIP_POD_WAIT:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

# 0. Docker and k3d
if ! docker info >/dev/null 2>&1; then
  warn "Docker is not reachable. Start Docker (or Colima) and re-run."
  exit 1
fi
ok "Docker reachable"

if ! k3d cluster list 2>/dev/null | grep -q "$CLUSTER"; then
  warn "k3d cluster '$CLUSTER' not found. Create it first: ./scripts/k3d-create-2-node-cluster.sh"
  exit 1
fi
ok "k3d cluster $CLUSTER exists"

k3d kubeconfig merge "$CLUSTER" --kubeconfig-merge-default 2>/dev/null || true
if ! kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
  warn "kubectl get nodes failed. Ensure ports 6443/55617 are free (lsof -i :6443 -i :55617). See Runbook #53."
  exit 1
fi
ok "API reachable"; kubectl get nodes --no-headers 2>/dev/null

# 0b. Prometheus Operator CRDs (for ServiceMonitors); run before base if you want servicemonitors in base
if [[ "$SKIP_BASE" != "1" ]] && ! kubectl get crd servicemonitors.monitoring.coreos.com >/dev/null 2>&1; then
  say "Installing Prometheus Operator CRDs (for ServiceMonitors)..."
  "$SCRIPT_DIR/install-prometheus-operator-crds.sh" 2>/dev/null || true
fi

# 1. Apply base
if [[ "$SKIP_BASE" != "1" ]]; then
  say "Step 1/4: Applying base (infra/k8s/base)..."
  kubectl apply -k infra/k8s/base --request-timeout=180s 2>&1 | tail -5
  ok "Base applied"
  # Re-apply registry image + IfNotPresent so kustomize doesn't leave imagePullPolicy: Never
  say "Re-patching deployments to registry image and IfNotPresent (strict TLS/mTLS unchanged)..."
  REG_NAME="k3d-${CLUSTER}-registry"
  for s in api-gateway auth-service records-service listings-service analytics-service python-ai-service messaging-service shopping-service auction-monitor; do
    kubectl set image "deployment/$s" -n record-platform "app=${REG_NAME}:5000/${s}:dev" 2>/dev/null || true
    kubectl patch deployment "$s" -n record-platform --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null || true
  done
  for d in haproxy nginx nginx-exporter haproxy-exporter; do kubectl scale deployment "$d" -n record-platform --replicas=1 2>/dev/null || true; done
  # Ensure haproxy-cm exists (kustomize configMapGenerator may not apply if haproxy not in kustomization scope)
  if ! kubectl get configmap haproxy-cm -n record-platform >/dev/null 2>&1; then
    kubectl create configmap haproxy-cm -n record-platform --from-file=haproxy.cfg=infra/k8s/base/haproxy/haproxy.cfg --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null && ok "haproxy-cm created" || warn "haproxy-cm create failed"
  fi
  # Ensure nginx-cm exists so nginx and nginx-exporter can start
  if ! kubectl get configmap nginx-cm -n record-platform >/dev/null 2>&1; then
    kubectl create configmap nginx-cm -n record-platform --from-file=nginx.conf=infra/k8s/base/nginx/nginx.conf --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null && ok "nginx-cm created" || warn "nginx-cm create failed"
  fi
  # Kafka SSL secret for analytics/auction-monitor/social/python-ai (strict TLS)
  if [[ -f certs/dev-root.pem ]] && [[ -f certs/dev-root.key ]] && [[ -f "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
    if ! kubectl get secret kafka-ssl-secret -n record-platform >/dev/null 2>&1; then
      "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null && ok "kafka-ssl-secret created" || warn "kafka-ssl-secret failed (run manually if Kafka TLS needed)"
    fi
  fi
  ok "Deployments patched (registry + IfNotPresent); strict TLS/mTLS env and volumeMounts unchanged"
else
  info "Step 1/4: Skipping base (SKIP_BASE=1)"
fi

# 2. Registry push and patch deployments (so pods pull from registry)
if [[ "$SKIP_REGISTRY" != "1" ]]; then
  say "Step 2/4: Pushing images to registry and patching deployments..."
  "$SCRIPT_DIR/k3d-registry-push-and-patch.sh" "$CLUSTER" 2>&1 | tail -30
  ok "Registry push and patch done"
else
  info "Step 2/4: Skipping registry (SKIP_REGISTRY=1)"
fi

# 3. MetalLB
if [[ "$SKIP_METALLB" != "1" ]]; then
  say "Step 3/4: Installing MetalLB (chunked)..."
  # Prefer pool in k3d network so LoadBalancer IPs are routable from host
  if [[ -z "${METALLB_POOL:-}" ]]; then
    SUBNET=$(docker network inspect "k3d-${CLUSTER}" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true)
    if [[ "$SUBNET" =~ ^172\. ]]; then
      # e.g. 172.18.0.0/16 -> use .240-.250
      METALLB_POOL="172.18.0.240-172.18.0.250"
      info "Using METALLB_POOL=$METALLB_POOL (k3d network)"
    elif [[ -n "$SUBNET" ]]; then
      # other subnet: use last octet range
      METALLB_POOL=""
      info "Set METALLB_POOL to a range in $SUBNET (e.g. export METALLB_POOL=...)"
    fi
  fi
  METALLB_POOL="${METALLB_POOL:-172.18.0.240-172.18.0.250}" \
    "$SCRIPT_DIR/install-metallb-chunked.sh" 2>&1 || warn "MetalLB install had issues; check metallb-system pods"
  ok "MetalLB install attempted"
else
  info "Step 3/4: Skipping MetalLB (SKIP_METALLB=1)"
fi

# 4. Wait for pods and verify
if [[ "$SKIP_POD_WAIT" != "1" ]]; then
  say "Step 4/4: Waiting for record-platform pods (up to 300s)..."
  for i in $(seq 1 30); do
    not_ready=$(kubectl get pods -n record-platform --no-headers 2>/dev/null | grep -vE "Running|Completed|Succeeded" | grep -c . || echo "0")
    if [[ "${not_ready}" == "0" ]]; then
      ok "All record-platform pods running or completed"
      break
    fi
    [[ $i -eq 30 ]] && warn "Some pods still not ready after 300s"
    sleep 10
  done
  kubectl get pods -n record-platform --no-headers 2>/dev/null | head -25
else
  info "Step 4/4: Skipping pod wait (SKIP_POD_WAIT=1)"
fi

echo ""
ok "Setup done."
info "Verify: kubectl get nodes; kubectl get pods -n record-platform; kubectl get svc -A | grep LoadBalancer"
info "Next: ./scripts/run-preflight-scale-and-all-suites.sh  (when ready)"
info "Future work: shedding, priority-based access, QoS — see docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md"
