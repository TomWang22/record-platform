#!/usr/bin/env bash
# Diagnose why host cannot reach k3d Caddy on 127.0.0.1:443 (or 8443).
# Run: ./scripts/diagnose-k3d-443-host.sh
# See docs/HTTP3-K3D-DOCKER-PROXY.md and scripts/test-http3-k3d-443.sh.
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
section() { printf "\n\033[1m=== %s ===\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

section "1. Who is using port 443 on the host?"
if command -v lsof >/dev/null 2>&1; then
  if lsof -i :443 -i UDP:443 2>/dev/null | head -20; then
    warn "Port 443 is in use. k3d may have failed to bind, or is not the listener."
  else
    info "Nothing in lsof for 443 (no TCP or UDP listener)."
  fi
else
  info "lsof not found; skipping."
fi

section "2. k3d loadbalancer container and port mapping"
LB_NAME=""
for c in k3d-record-platform-serverlb k3d-record-platform-serverlb-1; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
    LB_NAME="$c"
    break
  fi
done
if [[ -z "$LB_NAME" ]]; then
  # Try any serverlb
  LB_NAME=$(docker ps --format '{{.Names}}' 2>/dev/null | grep serverlb | head -1 || true)
fi
if [[ -n "$LB_NAME" ]]; then
  ok "Loadbalancer container: $LB_NAME"
  docker port "$LB_NAME" 2>/dev/null || warn "Could not get docker port"
  info "Interpretation: HOST_PORT->CONTAINER_PORT. If you see 443/tcp -> 0.0.0.0:443, host 443 should forward to LB."
else
  warn "No k3d serverlb container found. Is the cluster running? (k3d cluster list)"
fi

section "3. Can the host reach 127.0.0.1:443 and 127.0.0.1:8443?"
for port in 443 8443; do
  if nc -z 127.0.0.1 "$port" 2>/dev/null; then
    ok "127.0.0.1:$port is open"
  else
    warn "127.0.0.1:$port not reachable (connection refused or no listener)"
  fi
done

section "4. Caddy pods and service (in-cluster)"
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"k3d"* ]]; then
  kubectl -n ingress-nginx get pods -l app=caddy-h3 2>/dev/null || true
  kubectl -n ingress-nginx get svc caddy-h3 2>/dev/null || true
else
  info "Context is not k3d; skipping."
fi

section "5. What to do"
echo "If docker port shows 443->443 but lsof shows nothing and 127.0.0.1:443 is not reachable:"
echo "  Colima is not forwarding Docker's published 443 to the macOS host (triple-layer: Mac → Colima → Docker → k3d)."
echo "  This is Colima port-forwarding behavior, not a Kubernetes or Caddy bug. Use host 8443 (Option B)."
echo ""
echo "If port 443 is in use on the Mac when k3d was created, Docker may not have bound it."
echo ""
echo "Option A — Free 443 and recreate (often still fails on macOS+Colima for 443):"
echo "  1) Stop whatever uses 443 (e.g. Apache, nginx, another container)."
echo "  2) ./scripts/k3d-create-record-platform-443-lb.sh"
echo "  3) Re-run bring-up and test."
echo ""
echo "Option B — Use host port 8443 (recommended on macOS+Colima; no 443 on host):"
echo "  1) Recreate cluster (script defaults to 8443):"
echo "     k3d cluster delete record-platform"
echo "     ./scripts/k3d-create-record-platform-443-lb.sh"
echo "  2) From Mac: curl -k -I --http2 -H 'Host: record.local' https://127.0.0.1:8443/_caddy/healthz"
echo "     and: curl -k -I --http3-only -H 'Host: record.local' --resolve 'record.local:8443:127.0.0.1' https://record.local/_caddy/healthz"
echo ""
echo "Then run: K3D_HOST_PORT=8443 ./scripts/test-http3-k3d-443.sh  (if script supports it)"
say "Done."
