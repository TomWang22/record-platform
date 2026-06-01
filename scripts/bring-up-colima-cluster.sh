#!/usr/bin/env bash
# Bring up Colima + k3s cluster: certs, namespaces, kustomize, Caddy (LoadBalancer via MetalLB).
# Prereq: Colima running with k3s + --network-address; MetalLB installed (./scripts/install-metallb-colima.sh).
# Usage: ./scripts/bring-up-colima-cluster.sh
# See docs/COLIMA-K3S-METALLB-PRIMARY.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

# --- 0. Colima: refresh kubeconfig (port can change after restart), then fix VM IP → 127.0.0.1 ---
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]]; then
  [[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
  [[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
fi

# --- 1. Context must be Colima (not k3d), API up ---
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"k3d"* ]]; then
  warn "Current context is k3d. For Colima + MetalLB use: ./scripts/colima-start-k3s-bridged.sh"
  exit 1
fi
if ! kubectl get nodes --request-timeout=15s &>/dev/null; then
  warn "Cannot reach API. Run: ./scripts/colima-fix-kubeconfig-localhost.sh   then retry; or start Colima: ./scripts/colima-start-k3s-bridged.sh"
  exit 1
fi
ok "Cluster reachable ($ctx)"

# --- 2. MetalLB should be installed so LoadBalancer gets an IP ---
if ! kubectl get ns metallb-system &>/dev/null; then
  warn "MetalLB not installed. Run first: ./scripts/install-metallb-colima.sh"
  exit 1
fi
ok "MetalLB namespace present"

# --- 3. Certs ---
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
  ok "Certs present"
fi

# --- 4. Namespaces ---
kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace record-platform --dry-run=client -o yaml | kubectl apply -f -
ok "Namespaces ensured"

# --- 5. TLS secrets ---
say "Bootstrapping TLS secrets (ingress-nginx + record-platform)..."
bash "$SCRIPT_DIR/strict-tls-bootstrap.sh"
ok "TLS secrets applied"

# --- 5b. Kafka SSL secret (canonical writer only — never partial ca-cert-only overwrite) ---
if [[ -f "certs/kafka-ssl/ca-cert.pem" ]] && [[ -f "certs/kafka-ssl/client.crt" ]]; then
  HOUSING_NS=record-platform bash "$SCRIPT_DIR/apply-rp-kafka-ssl-secret.sh"
  ok "kafka-ssl-secret (full JKS + client mTLS) via apply-rp-kafka-ssl-secret.sh"
elif [[ -f "certs/kafka-ssl/kafka.keystore.jks" ]] && [[ -f "certs/kafka-ssl/kafka.truststore.jks" ]]; then
  warn "kafka-ssl JKS present but client.crt missing — run: bash scripts/kafka-ssl-from-dev-root.sh"
else
  warn "kafka-ssl material not ready — P5b bootstrap will run kafka-ssl-from-dev-root.sh (do not apply ca-cert-only secret)"
fi

# --- 6. Prometheus Operator CRDs ---
if [[ -x "$SCRIPT_DIR/install-prometheus-operator-crds.sh" ]]; then
  say "Installing Prometheus Operator CRDs..."
  "$SCRIPT_DIR/install-prometheus-operator-crds.sh" 2>/dev/null || true
  ok "CRDs installed (or already present)"
fi

# --- 7. Apply base + overlay (no k3d patch; Colima uses host.docker.internal) ---
say "Applying kustomize (infra/k8s/overlays/dev)..."
kubectl apply -k infra/k8s/overlays/dev
ok "Base and overlay applied"

# --- 8. Build :dev images (Colima uses host Docker; images must exist for deployments) ---
SKIP_IMAGES="${SKIP_IMAGES:-0}"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor)
if [[ "$SKIP_IMAGES" != "1" ]] && command -v docker &>/dev/null; then
  say "Building :dev images (Colima uses same Docker; pods will use these)..."
  KARCH=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || uname -m)
  case "$KARCH" in
    aarch64|arm64) PLAT="linux/arm64" ;;
    x86_64|amd64)  PLAT="linux/amd64" ;;
    *)             PLAT="linux/amd64" ;;
  esac
  for name in "${SERVICES[@]}"; do
    if docker image inspect "$name:dev" &>/dev/null; then
      echo "  $name:dev already built"
    elif [[ -f "$REPO_ROOT/services/$name/Dockerfile" ]]; then
      # python-ai-service Dockerfile copies proto/ and services/python-ai-service/app — needs repo root context.
      docker build --platform="$PLAT" -t "$name:dev" -f "$REPO_ROOT/services/$name/Dockerfile" "$REPO_ROOT"
    fi
  done
  ok "Images built (Colima k8s will use them when Docker context is colima)"
else
  [[ "$SKIP_IMAGES" == "1" ]] && say "Skipping image build (SKIP_IMAGES=1)" || warn "Docker not available; ensure :dev images exist for Colima"
fi

# --- 8b. Pre-pull Caddy image (Colima bridged: VM DNS may be 192.168.5.1 and fail to resolve registry-1.docker.io) ---
if [[ "$ctx" == *"colima"* ]] && command -v colima &>/dev/null && command -v docker &>/dev/null; then
  if ! docker image inspect caddy:2.8 &>/dev/null 2>&1; then
    say "Pre-pulling caddy:2.8 (VM DNS with bridged can break Docker Hub lookup)..."
    if ! docker pull caddy:2.8 2>/dev/null; then
      echo "  Pull failed (often: VM uses 192.168.5.1 for DNS and it does not resolve registry-1.docker.io)."
      echo "  Adding fallback nameserver 1.1.1.1 in VM and retrying..."
      colima ssh -- 'grep -q "1.1.1.1" /etc/resolv.conf || (echo "nameserver 1.1.1.1" | sudo tee -a /etc/resolv.conf)' 2>/dev/null || true
      sleep 1
      if ! docker pull caddy:2.8 2>/dev/null; then
        warn "Pre-pull still failed. In VM run: colima ssh -- sudo sed -i \"1i nameserver 1.1.1.1\" /etc/resolv.conf  then retry bring-up or: kubectl -n ingress-nginx rollout restart deploy/caddy-h3"
        echo "  Or ensure your router/DHCP at 192.168.5.1 provides working DNS."
      else
        ok "caddy:2.8 pulled after DNS fix"
      fi
    else
      ok "caddy:2.8 pre-pulled"
    fi
  fi
fi

# --- 9. Caddy with LoadBalancer (MetalLB assigns IP) ---
say "Deploying Caddy (LoadBalancer, MetalLB L2)..."
if ! CADDY_USE_LOADBALANCER=1 "$SCRIPT_DIR/rollout-caddy.sh"; then
  warn "Caddy rollout timed out. Check: kubectl get pods -n ingress-nginx -l app=caddy-h3"
  echo "  If pods are ImagePullBackOff: VM DNS may not resolve registry-1.docker.io. Run: colima ssh -- sudo sed -i \"1i nameserver 1.1.1.1\" /etc/resolv.conf  then: kubectl -n ingress-nginx rollout restart deploy/caddy-h3"
  exit 1
fi
ok "Caddy deploy applied"

say "Bring-up complete"
echo "  Caddy LB IP: kubectl -n ingress-nginx get svc caddy-h3"
echo "  HTTP/3 (direct, no 127.0.0.1/socat): ./scripts/verify-colima-http3-direct.sh"
echo "  Full verify: ./scripts/verify-metallb-and-traffic-policy.sh"
echo "  From Mac:    curl -k --http3-only https://\$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}')/_caddy/healthz"
echo "  Deps:        ./scripts/ensure-dependencies-ready.sh  # Redis, Kafka, ZK, 8 Postgres + Kafka SSL secret"
