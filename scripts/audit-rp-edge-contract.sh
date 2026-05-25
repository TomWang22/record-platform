#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
issues=()
NS_INGRESS="${RP_INGRESS_NS:-ingress-nginx}"
APP_NS="${RP_K8S_NS:-record-platform}"
CADDY="$REPO_ROOT/Caddyfile"

kubectl get ns "$NS_INGRESS" >/dev/null 2>&1 || issues+=("missing namespace $NS_INGRESS")
kubectl get svc caddy-h3 -n "$NS_INGRESS" >/dev/null 2>&1 || issues+=("missing svc caddy-h3 in $NS_INGRESS")

grep -q 'api-gateway.record-platform.svc.cluster.local:4000' "$CADDY" 2>/dev/null \
  || issues+=("Caddy must route REST to api-gateway:4000")
grep -q 'nginx.record-platform.svc.cluster.local:8080' "$CADDY" 2>/dev/null \
  || issues+=("Caddy web catch-all must proxy nginx:8080")
grep -q 'header Content-Type application/grpc' "$CADDY" 2>/dev/null \
  || issues+=("gRPC must use Content-Type application/grpc* matcher (not path_regexp)")
grep -qE 'path_regexp.*grpc|@grpc path_regexp' "$CADDY" 2>/dev/null \
  && issues+=("Caddy must not use path_regexp for gRPC routing")
grep -q '/jaeger' "$CADDY" 2>/dev/null || issues+=("missing /jaeger edge route")
grep -q '/grafana' "$CADDY" 2>/dev/null || issues+=("missing /grafana edge route")
grep -q '/prometheus' "$CADDY" 2>/dev/null || issues+=("missing /prometheus edge route")
grep -q 'respond "Misdirected Request" 421' "$CADDY" 2>/dev/null \
  || issues+=("fallback :443 must return 421 for wrong SNI")
grep -q '/social' "$CADDY" 2>/dev/null && issues+=("Caddy must not route /social")
grep -qE '/booking|/bookings' "$CADDY" 2>/dev/null && issues+=("Caddy must not route booking paths")
grep -q 'health_uri' "$CADDY" 2>/dev/null && issues+=("remove active Caddy health_uri checks on api-gateway (use K8s readiness)")
grep -q 'X-RP-Edge-Proto' "$CADDY" 2>/dev/null || issues+=("missing X-RP-Edge-Proto edge header")
grep -q 'TLS_AES_128_GCM_SHA256' "$CADDY" 2>/dev/null || issues+=("missing TLS cipher suite on SNI block")

[[ ${#issues[@]} -gt 0 ]] && { printf '%s\n' "${issues[@]}" >&2; exit 1; }
echo "✅ edge contract audit passed"
