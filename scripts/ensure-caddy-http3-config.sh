#!/usr/bin/env bash
# Re-apply Caddy ConfigMap from repo Caddyfile and restart Caddy so HTTP/3 (QUIC) is enabled.
# Use when diagnose-http3-causal.sh shows: no UDP 443 in pod, or Caddyfile in pod missing "protocols h3".
#
# Root cause: ConfigMap caddy-h3 was created from an older/different Caddyfile that lacked
# the global "servers { protocols h1 h2 h3 }" block. This script re-applies from repo and restarts.
#
# Usage: ./scripts/ensure-caddy-http3-config.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"
CADDYFILE="${REPO_ROOT}/Caddyfile"
[[ -f "$CADDYFILE" ]] || CADDYFILE="${REPO_ROOT}/docs/Caddyfile"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

if [[ ! -f "$CADDYFILE" ]]; then
  warn "Caddyfile not found at $REPO_ROOT/Caddyfile or docs/Caddyfile"
  exit 1
fi

if ! grep -qE "h3|protocols.*h2.*h3" "$CADDYFILE"; then
  warn "Repo Caddyfile does not appear to enable HTTP/3 (no h3 / protocols h2 h3). Add: servers { protocols h1 h2 h3 }"
  exit 1
fi

say "Re-applying Caddy ConfigMap from $CADDYFILE and restarting Caddy"
kubectl create configmap caddy-h3 -n "$NS" --from-file=Caddyfile="$CADDYFILE" --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/caddy-h3 -n "$NS"
ok "ConfigMap applied and rollout restarted. Wait for pods: kubectl get pods -n $NS -l app=caddy-h3 -w"
kubectl rollout status deployment/caddy-h3 -n "$NS" --timeout=120s && ok "Caddy rollout complete (HTTP/3 should be listening)" || warn "Rollout did not complete in 120s; check pod status"
echo ""
info "Production Caddyfile (record.local + strict TLS) applied. Validate QUIC: ./scripts/verify-caddy-http3-in-cluster.sh (uses record.local and dev-root-ca)."
