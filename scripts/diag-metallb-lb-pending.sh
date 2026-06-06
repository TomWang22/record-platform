#!/usr/bin/env bash
# diag-metallb-lb-pending.sh — Diagnose and fix when caddy-h3 has EXTERNAL-IP <pending>
# MetalLB can clear an IP when pool config changes ("ClearAssignment ... not allowed by config").
# Run from repo root. See docs/METALLB_EXTERNAL_IP_PENDING_FIX.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS_ING="ingress-nginx"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

say "=== 1. caddy-h3 Service status ==="
kubectl -n "$NS_ING" get svc caddy-h3 -o wide 2>/dev/null || fail "caddy-h3 service not found"
EXT_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
if [[ -z "$EXT_IP" ]]; then
  warn "EXTERNAL-IP is <pending> — MetalLB has not assigned an IP"
  say "=== 2. MetalLB pool config ==="
  kubectl get ipaddresspools -A 2>/dev/null || warn "No IPAddressPools (MetalLB not installed?)"
  kubectl describe ipaddresspool -n metallb-system 2>/dev/null | head -40 || true
  say "=== 3. MetalLB controller logs (recent) ==="
  kubectl -n metallb-system logs deploy/controller --tail=30 2>/dev/null | grep -iE "assign|clear|pool|error|caddy" || true
  say ""
  say "=== Fix steps (see docs/METALLB_EXTERNAL_IP_PENDING_FIX.md) ==="
  echo "  1. Check pool allowed range: kubectl describe ipaddresspool -n metallb-system"
  echo "  2. Pool must include IPs on your VM network (e.g. 192.168.64.240-192.168.64.250 for Colima col0)"
  echo "  3. Find VM subnet: colima ssh -- ip addr  # use same subnet for METALLB_POOL"
  echo "  4. Re-apply pool: METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/install-metallb-colima.sh"
  echo "  5. Force reassignment: kubectl -n ingress-nginx delete svc caddy-h3"
  echo "  6. Recreate: CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh"
  echo "  7. Verify: kubectl -n ingress-nginx get svc caddy-h3   # EXTERNAL-IP must show an IP"
  exit 1
fi
ok "caddy-h3 has EXTERNAL-IP: $EXT_IP"
