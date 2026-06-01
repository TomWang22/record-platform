#!/usr/bin/env bash
# Bring up k3d cluster and all platform pods (Caddy hostPort, app deployments, optional external infra).
# Prereq: cluster created with ./scripts/k3d-create-record-platform-443-lb.sh
# Usage: ./scripts/bring-up-k3d-cluster.sh
#   SKIP_EXTERNAL_INFRA=1 (default) — skip Redis/Postgres/Kafka. Set 0 to start docker compose for them.
#   SKIP_IMAGES=0 (default) — build :dev images and import into k3d. Set 1 to skip (e.g. use registry later).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# --- 1. Cluster must be k3d and up ---
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"k3d"* ]]; then
  warn "Current context is not k3d: $ctx"
  echo "  Create cluster: ./scripts/k3d-create-record-platform-443-lb.sh"
  exit 1
fi
if ! kubectl get nodes --request-timeout=15s &>/dev/null; then
  warn "Cannot reach API. Start cluster: k3d cluster start record-platform"
  exit 1
fi
ok "Cluster reachable ($ctx)"

# --- 2. Certs for TLS secrets and kustomize base ---
if [[ ! -f "certs/record.local.crt" ]] || [[ ! -f "certs/dev-root.pem" ]]; then
  say "Generating certs into certs/ (mkcert)..."
  command -v mkcert &>/dev/null || { warn "Install mkcert: brew install mkcert && mkcert -install"; exit 1; }
  mkdir -p certs
  CA_PATH="$(mkcert -CAROOT)/rootCA.pem"
  mkcert -cert-file certs/record.local.crt -key-file certs/record.local.key \
    record.local "*.record.local" localhost 127.0.0.1 2>/dev/null
  cp -f "$CA_PATH" certs/dev-root.pem
  ok "Certs written to certs/"
else
  ok "Certs present (certs/record.local.crt, certs/dev-root.pem)"
fi

# --- 3. Namespaces ---
kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
ok "Namespaces ensured"

# --- 4. TLS secrets in both namespaces ---
say "Bootstrapping TLS secrets (ingress-nginx + record-platform)..."
bash "$SCRIPT_DIR/strict-tls-bootstrap.sh"
ok "TLS secrets applied"

# --- 5. Prometheus Operator CRDs (for ServiceMonitor in base) ---
if [[ -x "$SCRIPT_DIR/install-prometheus-operator-crds.sh" ]]; then
  say "Installing Prometheus Operator CRDs..."
  "$SCRIPT_DIR/install-prometheus-operator-crds.sh" 2>/dev/null || true
  ok "CRDs installed (or already present)"
fi

# --- 6. Apply base + overlay ---
say "Applying kustomize (infra/k8s/overlays/dev)..."
kubectl apply -k infra/k8s/overlays/dev
ok "Base and overlay applied"

# --- 6b. k3d: app-config must use host.k3d.internal (not host.docker.internal) so pods reach Redis/Postgres on host
say "Patching app-config for k3d (host.k3d.internal)..."
kubectl -n record-platform get configmap app-config -o yaml | sed 's/host\.docker\.internal/host.k3d.internal/g' | kubectl apply -f -
ok "app-config patched for k3d"

# --- 7. Caddy with hostPort + ClusterIP (no NodePort) ---
say "Deploying Caddy (hostPort 443, ClusterIP)..."
if ! CADDY_USE_HOSTPORT=1 "$SCRIPT_DIR/rollout-caddy.sh"; then
  warn "Caddy rollout status timed out (with maxSurge:1 + 2 nodes a 3rd pod can stay Pending). If 2/2 Caddy pods are Running, you're good."
  echo "  Check: kubectl get pods -n ingress-nginx -l app=caddy-h3"
fi
ok "Caddy deploy applied"

# --- 8. Build and import app images into k3d ---
SKIP_IMAGES="${SKIP_IMAGES:-0}"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service messaging-service shopping-service auction-monitor)
if [[ "$SKIP_IMAGES" != "1" ]] && command -v docker &>/dev/null; then
  say "Building :dev images and importing into k3d..."
  KARCH=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || uname -m)
  case "$KARCH" in
    aarch64|arm64) PLAT="linux/arm64" ;;
    x86_64|amd64)  PLAT="linux/amd64" ;;
    *)             PLAT="linux/amd64" ;;
  esac
  for name in "${SERVICES[@]}"; do
    if docker image inspect "$name:dev" &>/dev/null; then
      echo "  $name:dev already built"
    elif [[ -f "services/$name/Dockerfile" ]]; then
      if [[ "$name" == "python-ai-service" ]]; then
        docker build --platform="$PLAT" -t "$name:dev" -f "services/$name/Dockerfile" "services/$name"
      else
        docker build --platform="$PLAT" -t "$name:dev" -f "services/$name/Dockerfile" .
      fi
    fi
    if docker image inspect "$name:dev" &>/dev/null; then
      k3d image import "$name:dev" -c record-platform 2>/dev/null && echo "  imported $name:dev" || true
    fi
  done
  ok "Images built and imported (restart deployments if pods still ImagePullBackOff)"
else
  [[ "$SKIP_IMAGES" == "1" ]] && say "Skipping image build (SKIP_IMAGES=1)" || warn "Docker not available; skip image build"
fi

# --- 9. Optional: external Redis, Postgres, Kafka ---
SKIP_EXTERNAL_INFRA="${SKIP_EXTERNAL_INFRA:-1}"
if [[ "$SKIP_EXTERNAL_INFRA" != "1" ]] && [[ -f "$REPO_ROOT/docker-compose.yml" ]]; then
  say "Starting external infra (Redis, Postgres, Kafka)..."
  "$SCRIPT_DIR/bring-up-external-infra.sh" 2>&1 || true
  ok "External infra started (see bring-up-external-infra.sh)"
  # Kafka mTLS secret (full JKS + client certs — never ca-cert-only overwrite)
  if [[ -x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && [[ -f "$REPO_ROOT/certs/dev-root.key" ]]; then
    HOUSING_NS=record-platform bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" 2>/dev/null || \
      HOUSING_NS=record-platform bash "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh" 2>/dev/null || true
    ok "kafka-ssl-secret (canonical writer)"
  elif [[ -x "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh" ]] && [[ -d "$REPO_ROOT/certs/kafka-ssl" ]]; then
    HOUSING_NS=record-platform bash "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh" 2>/dev/null && ok "kafka-ssl-secret from certs/kafka-ssl" || true
  else
    warn "kafka-ssl material not ready — run kafka-ssl-from-dev-root.sh before app deploy"
  fi
  # Point kafka-external Endpoints to host so pods can reach Docker Kafka :29093
  [[ -x "$SCRIPT_DIR/patch-kafka-external-host.sh" ]] && "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null || true
else
  say "Skipping external infra (SKIP_EXTERNAL_INFRA=${SKIP_EXTERNAL_INFRA:-1}). Set SKIP_EXTERNAL_INFRA=0 and run ./scripts/bring-up-external-infra.sh to start Redis/Postgres/Kafka."
fi

say "Bring-up complete"
echo "  Nodes:    kubectl get nodes"
echo "  Pods:     kubectl get pods -n record-platform; kubectl get pods -n ingress-nginx"
echo "  Caddy:    curl -k -H 'Host: record.local' https://localhost:443/_caddy/healthz (or https://record.local if /etc/hosts and CA trusted)"
echo "  Next:     Ensure app-config POSTGRES_URL/Redis/Kafka point to your DBs; then kubectl -n record-platform rollout status deploy/..."
