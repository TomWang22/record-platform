#!/usr/bin/env bash
# HTTP/3 debug playbook: structured, deterministic, layered isolation.
# No MetalLB, no socat, no loopback alias. Pure: Docker → k3d loadbalancer → Service → Pod.
#
# OBJECTIVE: Isolate failure domain across (1) Docker publish (2) k3d loadbalancer (3) Service
#            (4) kube-proxy (5) Pod QUIC listener.
#
# Usage: ./scripts/http3-debug-playbook.sh [phase]
#   phase: 0|1|2|3|4|5|6|7 or empty (run 0-7 in order).
#   SKIP_PHASE0=1  skip cluster delete / Docker cleanup
#   RUN_PHASE7=1   run phase 7 (tcpdump) which waits for keypress
#
# See: docs/HTTP3_DEBUG_PLAYBOOK.md

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER_NAME="${K3D_CLUSTER_NAME:-record-platform}"
LB_CONTAINER="${K3D_LB_CONTAINER:-k3d-${CLUSTER_NAME}-serverlb}"
CURL_IMAGE="${CURL_IMAGE:-alpine/curl-http3:latest}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "ℹ️  $*"; }

# Optional phase argument
PHASE="${1:-}"
run_phase() {
  local p="$1"
  if [[ -n "$PHASE" ]]; then
    [[ "$p" == "$PHASE" ]] && return 0
    return 1
  fi
  return 0
}

cd "$REPO_ROOT"
MINIMAL_DIR="$REPO_ROOT/infra/k8s/caddy-h3-minimal-quic"

# --- Rule: If any node is NotReady, do NOT debug HTTP/3 ---
check_nodes_ready() {
  local not_ready
  not_ready=$(kubectl get nodes -o jsonpath='{.items[?(@.status.conditions[?(@.type=="Ready")].status!="True")].metadata.name}' 2>/dev/null | tr ' ' '\n' | grep -v '^$' || true)
  if [[ -n "$not_ready" ]]; then
    warn "Node(s) not Ready: $not_ready"
    kubectl get nodes 2>/dev/null | sed 's/^/  /'
    fail "Fix node readiness first. HTTP/3 debugging in undefined networking state."
  fi
  return 0
}

# --- PHASE 0 — Hard reset ---
phase0() {
  say "=== PHASE 0 — Hard reset (no dirty state) ==="
  if [[ "${SKIP_PHASE0:-0}" == "1" ]]; then
    info "SKIP_PHASE0=1: skipping cluster delete and Docker cleanup"
    return 0
  fi
  k3d cluster delete "$CLUSTER_NAME" 2>/dev/null || true
  docker rm -f $(docker ps -aq --filter "name=k3d" 2>/dev/null) 2>/dev/null || true
  docker network prune -f 2>/dev/null || true
  ok "Cluster removed and k3d containers pruned"
  echo ""
  warn "Restart Docker Desktop (or your Docker engine), wait until fully up, then re-run this script (or continue from phase 1)."
  echo "  To continue without full restart: SKIP_PHASE0=1 ./scripts/http3-debug-playbook.sh 1"
  exit 0
}

# --- PHASE 1 — Minimal clean cluster (443 on loadbalancer, no MetalLB) ---
phase1() {
  say "=== PHASE 1 — Create minimal clean cluster ==="
  if k3d cluster list 2>/dev/null | grep -q "^$CLUSTER_NAME "; then
    fail "Cluster $CLUSTER_NAME already exists. Run phase 0 first or: k3d cluster delete $CLUSTER_NAME"
  fi
  info "Creating: 1 server, 1 agent; 443:443 and 443:443/udp on loadbalancer (no MetalLB/socat/alias); Traefik disabled so hostPort 443 is free for Caddy)"
  k3d cluster create "$CLUSTER_NAME" \
    --agents 1 \
    --port "443:443@loadbalancer" \
    --port "443:443/udp@loadbalancer" \
    --k3s-arg "--disable=traefik@server:*" \
    --wait
  ok "Cluster created"
  kubectl get nodes
  check_nodes_ready
  ok "All nodes Ready"
}

# --- PHASE 2 — Deploy minimal QUIC Caddy only ---
phase2() {
  say "=== PHASE 2 — Deploy minimal QUIC Caddy ==="
  check_nodes_ready
  if [[ ! -f "$MINIMAL_DIR/namespace.yaml" ]] || [[ ! -f "$MINIMAL_DIR/caddyfile.yaml" ]] || [[ ! -f "$MINIMAL_DIR/deploy.yaml" ]]; then
    fail "Minimal Caddy manifests missing under $MINIMAL_DIR"
  fi
  kubectl apply -f "$MINIMAL_DIR/namespace.yaml" --request-timeout=10s
  kubectl apply -f "$MINIMAL_DIR/caddyfile.yaml" --request-timeout=10s
  kubectl apply -f "$MINIMAL_DIR/deploy.yaml" --request-timeout=10s
  info "Waiting for caddy-h3 pod (ingress-nginx)..."
  kubectl wait --for=condition=ready pod -l app=caddy-h3 -n ingress-nginx --timeout=120s 2>/dev/null || true
  kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide
  _ready=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
  if [[ "$_ready" != "True" ]]; then
    warn "Pod not Ready yet. Describe: kubectl describe pod -n ingress-nginx -l app=caddy-h3"
    kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide
    fail "Phase 2: Caddy pod must be Running and Ready"
  fi
  ok "Minimal Caddy pod Running"
}

# --- PHASE 3 — Verify container port binding (inside loadbalancer) ---
phase3() {
  say "=== PHASE 3 — Verify loadbalancer container port binding ==="
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${LB_CONTAINER}$"; then
    fail "Loadbalancer container $LB_CONTAINER not found. Is the cluster running?"
  fi
  info "Inside $LB_CONTAINER: ss -ulnp | grep 443"
  _udp=$(docker exec "$LB_CONTAINER" ss -ulnp 2>/dev/null | grep 443 || true)
  if [[ -z "$_udp" ]]; then
    warn "No UDP 443 in loadbalancer container. Docker publish may be misconfigured."
    docker exec "$LB_CONTAINER" ss -ulnp 2>/dev/null | sed 's/^/  /' || true
    fail "Phase 3: Expected UDP 443 listening in serverlb"
  fi
  ok "UDP 443 listening in loadbalancer container"
  echo "$_udp" | sed 's/^/  /'
}

# --- PHASE 4 — Test from inside cluster (isolates kube-proxy) ---
# Invariant: always use record.local (SNI + URL). Never IP or arbitrary hostname.
phase4() {
  say "=== PHASE 4 — Test from inside cluster ==="
  check_nodes_ready
  _cluster_ip=$(kubectl get svc caddy-h3 -n ingress-nginx -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
  [[ -z "$_cluster_ip" ]] && fail "Could not get caddy-h3 ClusterIP"
  info "Running curl --http3-only -k --resolve record.local:443:$_cluster_ip https://record.local/ (image: $CURL_IMAGE)"
  _overrides=$(cat <<OVEREOF
{"spec":{"containers":[{"name":"curl","image":"$CURL_IMAGE","command":["/bin/sh","-c","NGTCP2_ENABLE_GSO=0 curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --http3-only -k --resolve record.local:443:$_cluster_ip https://record.local/"]}]}}
OVEREOF
)
  _code=$(kubectl run http3-phase4 --rm -i --restart=Never -n ingress-nginx --image="$CURL_IMAGE" --overrides="$_overrides" </dev/null 2>/dev/null | tail -1 || echo "000")
  if [[ "$_code" != "200" ]]; then
    warn "In-cluster HTTP/3 returned $_code (expected 200). Ensure Caddy server block is record.local and client uses --resolve record.local:443:<ip> and https://record.local"
    info "If image lacks --http3-only: set CURL_IMAGE=alpine/curl-http3:latest"
    fail "Phase 4: Caddy QUIC not working inside cluster"
  fi
  ok "Phase 4: Internal QUIC works (record.local)"
}

# --- PHASE 5 — Test loadbalancer directly from host ---
phase5() {
  say "=== PHASE 5 — Test loadbalancer directly from host ==="
  _curl=""
  for c in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl curl; do
    if command -v "$c" 2>/dev/null | head -1 | grep -q .; then
      if "$c" --help all 2>/dev/null | grep -q -- "--http3-only"; then
        _curl="$c"
        break
      fi
    fi
  done
  if [[ -z "$_curl" ]]; then
    warn "No curl with --http3-only on host. Install: brew install curl (with ngtcp2)."
    info "Skipping Phase 5 host curl; Phase 4 result is the in-cluster verdict."
    return 0
  fi
  # Invariant: use record.local with --resolve so SNI matches Caddy server block
  info "Host: NGTCP2_ENABLE_GSO=0 $_curl --http3-only -k --resolve record.local:443:127.0.0.1 https://record.local/"
  _code=$(NGTCP2_ENABLE_GSO=0 "$_curl" -sS -o /dev/null -w '%{http_code}' --max-time 15 --http3-only -k --resolve "record.local:443:127.0.0.1" "https://record.local/" 2>/dev/null || echo "000")
  if [[ "$_code" == "200" ]]; then
    ok "Phase 5: localhost:443 HTTP/3 (record.local) returns 200"
  else
    warn "Phase 5: localhost:443 HTTP/3 returned $_code (expected 200)"
    info "If Phase 4 succeeded: break is Docker → k3d loadbalancer container (Docker UDP publish or lb config)."
    info "See Phase 7 for packet capture at each layer."
  fi
}

# --- PHASE 6 — Confirm Docker UDP publish ---
phase6() {
  say "=== PHASE 6 — Confirm Docker UDP publish ==="
  docker ps --format "table {{.Names}}\t{{.Ports}}" 2>/dev/null | grep -E "NAMES|serverlb|$LB_CONTAINER" || true
  _udp=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -o '443/udp' || true)
  if [[ -z "$_udp" ]]; then
    warn "Docker port list does not show 443/udp. Cluster may not have been created with 443:443/udp@loadbalancer."
    fail "Phase 6: Expected 0.0.0.0:443->443/udp (or similar) for serverlb"
  fi
  ok "Docker shows UDP 443 publish for loadbalancer"
}

# --- PHASE 7 — Packet capture at each layer ---
phase7() {
  say "=== PHASE 7 — Packet capture at each layer ==="
  info "On host, run in one terminal: sudo tcpdump -i lo0 udp port 443"
  info "In another: docker exec -it $LB_CONTAINER tcpdump -i eth0 udp port 443"
  info "Then send one request: curl --http3-only -k --resolve record.local:443:127.0.0.1 https://record.local/"
  echo ""
  if [[ "${RUN_PHASE7:-0}" != "1" ]]; then
    info "To run automated capture (host + lb container) set RUN_PHASE7=1 (requires sudo for host tcpdump)"
    return 0
  fi
  _pcap_host="/tmp/http3-playbook-host.pcap"
  _pcap_lb="/tmp/http3-playbook-lb.pcap"
  info "Capturing 12s on host (lo0) and in LB container..."
  sudo tcpdump -i lo0 -w "$_pcap_host" -U udp port 443 2>/dev/null &
  _pid_host=$!
  sleep 1
  docker exec "$LB_CONTAINER" tcpdump -i any -w /tmp/lb.pcap -U udp port 443 2>/dev/null &
  sleep 1
  _curl=""
  for c in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl curl; do
    if command -v "$c" 2>/dev/null && "$c" --help all 2>/dev/null | grep -q -- "--http3-only"; then
      _curl="$c"; break
    fi
  done
  if [[ -n "$_curl" ]]; then
    NGTCP2_ENABLE_GSO=0 "$_curl" -sS -o /dev/null -w '%{http_code}' --max-time 10 --http3-only -k --resolve "record.local:443:127.0.0.1" "https://record.local/" 2>/dev/null || true
  fi
  sleep 8
  sudo kill $_pid_host 2>/dev/null || true
  docker exec "$LB_CONTAINER" pkill tcpdump 2>/dev/null || true
  docker cp "$LB_CONTAINER:/tmp/lb.pcap" "$_pcap_lb" 2>/dev/null || true
  info "Host pcap: $_pcap_host (packets: $(sudo tcpdump -r "$_pcap_host" -n 2>/dev/null | wc -l))"
  info "LB pcap:   $_pcap_lb (inspect with tcpdump -r $_pcap_lb -n)"
  ok "Phase 7: Capture done. If packets on host but not in LB → Docker NAT issue."
}

# --- Interpretation table (printed at end) ---
print_interpretation() {
  say "=== Interpretation (docs/HTTP3_DEBUG_PLAYBOOK.md) ==="
  echo "  Phase 1 fails     → Cluster unhealthy (fix nodes first)"
  echo "  Phase 4 fails     → Caddy QUIC misconfig or not listening"
  echo "  Phase 4 ok, 5 fails → Docker UDP publish or k3d loadbalancer"
  echo "  Phase 6 no UDP    → Cluster not created with 443:443/udp@loadbalancer"
  echo "  Phase 7: packets host but not LB → Docker networking"
  echo "  Phase 7: packets in LB but no response → kube-proxy or Service routing"
}

# --- Main ---
main() {
  echo "HTTP/3 debug playbook — minimal cluster, no MetalLB/socat/alias"
  echo "Cluster: $CLUSTER_NAME  LB container: $LB_CONTAINER"
  if run_phase 0; then phase0; fi
  if run_phase 1; then phase1; fi
  if run_phase 2; then phase2; fi
  if run_phase 3; then phase3; fi
  if run_phase 4; then phase4; fi
  if run_phase 5; then phase5; fi
  if run_phase 6; then phase6; fi
  if run_phase 7; then phase7; fi
  print_interpretation
}

main "$@"
