#!/usr/bin/env bash
# One-shot restore: verify UDP 30443, show status, run LB IP setup (re-execs with sudo if needed), print curl test commands.
# Usage: ./scripts/restore-http3-setup.sh  (no sudo needed; setup will prompt for sudo once if LB IP path is used)
# For NodePort-only: run verify and status only; LB IP setup is skipped if Caddy has no LoadBalancer IP yet.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLUSTER_NAME="${1:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

say "=== HTTP/3 restore: verify → status → LB IP setup (if applicable) ==="

# 1) Verify k3d publishes TCP+UDP 30443
say "1. Verify k3d TCP+UDP 30443"
if [[ -f "$SCRIPT_DIR/verify-k3d-30443-udp.sh" ]]; then
  "$SCRIPT_DIR/verify-k3d-30443-udp.sh" "$CLUSTER_NAME" || { warn "UDP 30443 not published — recreate cluster with $SCRIPT_DIR/k3d-create-2-node-cluster.sh"; exit 1; }
else
  warn "verify-k3d-30443-udp.sh not found; skipping"
fi

# 2) Status (nodes, registry, Caddy, checklist)
say "2. Status (nodes, registry, Caddy, HTTP/3 checklist)"
if [[ -f "$SCRIPT_DIR/k3d-status-and-http3-debug.sh" ]]; then
  "$SCRIPT_DIR/k3d-status-and-http3-debug.sh" "$CLUSTER_NAME" || true
fi

# 3) LB IP setup if Caddy has an EXTERNAL-IP (MetalLB)
LB_IP=""
if command -v kubectl >/dev/null 2>&1; then
  LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
fi
if [[ -n "$LB_IP" ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]]; then
  say "3. LB IP setup ($LB_IP) — may prompt for sudo"
  LB_IP="$LB_IP" NODEPORT=30443 "$SCRIPT_DIR/setup-lb-ip-host-access.sh" || warn "Setup had issues; run manually: LB_IP=$LB_IP NODEPORT=30443 $SCRIPT_DIR/setup-lb-ip-host-access.sh"
else
  if [[ -z "$LB_IP" ]]; then
    info "3. No Caddy LoadBalancer IP yet (MetalLB not installed or Caddy not LoadBalancer). NodePort 30443 still works for HTTP/3."
  fi
fi

# 4) Print test commands
say "4. Test HTTP/2 and HTTP/3 (copy-paste)"
echo "  # NodePort (works without MetalLB):"
echo "  curl -k --http2 -sS -o /dev/null -w '%{http_code}' --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz"
echo "  NGTCP2_ENABLE_GSO=0 curl --http3-only -k -sS -o /dev/null -w '%{http_code}' --resolve record.local:30443:127.0.0.1 https://record.local:30443/_caddy/healthz"
if [[ -n "$LB_IP" ]]; then
  echo "  # LB IP (after setup above):"
  echo "  curl -k --http2 -sS -o /dev/null -w '%{http_code}' --resolve record.local:443:$LB_IP https://record.local/_caddy/healthz"
  echo "  NGTCP2_ENABLE_GSO=0 curl --http3-only -k -sS -o /dev/null -w '%{http_code}' --resolve record.local:443:$LB_IP https://record.local/_caddy/healthz"
fi
ok "Restore complete. Run preflight or suites to test end-to-end."
