#!/usr/bin/env bash
# diag-caddy-grpc-upstream.sh — Copilot-recommended diagnostics for Caddy → Envoy gRPC proxy
# Run from repo root. Confirms whether Caddy forwards gRPC to Envoy over h2c.
set -euo pipefail

NS_ING="ingress-nginx"
NS_ENVOY="envoy-test"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

# Caddy image has no curl; use ephemeral curl pod in same namespace (same network as Caddy)
CURL_POD="curl-diag-grpc-$$"
trap 'kubectl -n "$NS_ING" delete pod "$CURL_POD" --ignore-not-found --wait=false 2>/dev/null' EXIT

say "=== 1. Caddy netns → Envoy (plain HTTP) ==="
if kubectl run -n "$NS_ING" "$CURL_POD" --restart=Never --image=curlimages/curl:latest -- sleep 120 2>/dev/null; then
  kubectl wait -n "$NS_ING" pod/"$CURL_POD" --for=condition=Ready --timeout=30s 2>/dev/null || true
  if kubectl exec -n "$NS_ING" "$CURL_POD" -- curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://envoy-test.envoy-test.svc.cluster.local:10000 2>/dev/null | grep -qE '^[0-9]+'; then
    ok "Caddy netns can reach Envoy on 10000"
  else
    warn "Caddy netns → Envoy HTTP failed (upstream may be broken)"
    kubectl exec -n "$NS_ING" "$CURL_POD" -- curl -v --max-time 5 http://envoy-test.envoy-test.svc.cluster.local:10000 2>&1 | tail -15
  fi

  say "=== 2. Caddy netns → Envoy (HTTP/2 prior-knowledge / h2c) ==="
  if kubectl exec -n "$NS_ING" "$CURL_POD" -- curl -s -o /dev/null -w "%{http_code}" --max-time 5 --http2-prior-knowledge http://envoy-test.envoy-test.svc.cluster.local:10000 2>/dev/null | grep -qE '^[0-9]+'; then
    ok "h2c works; Caddy reverse_proxy should use transport http { versions h2c }"
  else
    warn "h2c test failed (Envoy may reject HTTP/1.1)"
    kubectl exec -n "$NS_ING" "$CURL_POD" -- curl -v --max-time 5 --http2-prior-knowledge http://envoy-test.envoy-test.svc.cluster.local:10000 2>&1 | tail -15
  fi
else
  warn "Could not create curl pod; skip steps 1–2"
fi

say "=== 3. Live Caddyfile (gRPC block) ==="
CADDY_POD=$(kubectl -n "$NS_ING" get pods -l app=caddy-h3 --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$CADDY_POD" ]]; then
  kubectl exec -n "$NS_ING" "$CADDY_POD" -- cat /etc/caddy/Caddyfile 2>/dev/null | grep -A 12 "@grpc path_regexp" || warn "gRPC block not found in Caddyfile"
else
  warn "No Running caddy-h3 pod; skip Caddyfile dump"
fi

ENVOY_POD=$(kubectl -n "$NS_ENVOY" get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
[[ -z "$ENVOY_POD" ]] && warn "No envoy-test pod in $NS_ENVOY"

say "=== 4. Host grpcurl via Caddy (TLS + LB) ==="
# Dynamic LB IP: MetalLB can reassign after Caddy rollout; never use hardcoded IP
LB_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
[[ -z "$LB_IP" ]] && LB_IP=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
NODEPORT=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null)
CA="$REPO_ROOT/certs/dev-root.pem"

if [[ -z "$LB_IP" ]] && kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q LoadBalancer; then
  warn "EXTERNAL-IP is <pending> — MetalLB has not assigned an IP. This is not TLS/CA; it's MetalLB."
  warn "  Run: ./scripts/diag-metallb-lb-pending.sh   (docs/METALLB_EXTERNAL_IP_PENDING_FIX.md)"
fi

if [[ ! -f "$CA" ]]; then
  warn "certs/dev-root.pem not found; skip grpcurl test"
elif command -v grpcurl >/dev/null 2>&1; then
  if [[ -n "$LB_IP" ]]; then
    say "  Trying grpcurl -cacert $CA -authority record.local $LB_IP:443 list"
    if grpcurl -cacert "$CA" -authority record.local -max-time 5 "$LB_IP:443" list 2>/dev/null; then
      ok "grpcurl via Caddy LB succeeded"
    else
      OUT=$(grpcurl -cacert "$CA" -authority record.local -max-time 5 "$LB_IP:443" list 2>&1)
      warn "grpcurl failed: $(echo "$OUT" | head -3)"
    fi
  elif [[ -n "$NODEPORT" ]]; then
    say "  No LB IP; trying NodePort $NODEPORT (may need --resolve or localhost)"
    warn "  Run manually: grpcurl -cacert $CA -authority record.local <host>:${NODEPORT} list"
  else
    warn "No Caddy external IP or NodePort; skip grpcurl"
  fi
else
  warn "grpcurl not installed; skip"
fi

say "=== 5. Envoy receiving traffic? (tcpdump port 10000, 5s) ==="
if [[ -n "$ENVOY_POD" ]]; then
  say "  Run grpcurl in another terminal, then:"
  echo "  kubectl exec -n $NS_ENVOY $ENVOY_POD -- tcpdump -i any -c 20 port 10000"
  echo "  If TCP 10000 = 0 packets when grpcurl runs → Caddy not forwarding gRPC to Envoy"
else
  warn "No Envoy pod; skip tcpdump hint"
fi

say "Done. See docs/CADDY_GRPC_REVERSE_PROXY_SETUP.md for fix."
