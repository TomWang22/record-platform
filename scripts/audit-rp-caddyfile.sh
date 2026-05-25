#!/usr/bin/env bash
# Static audit of RP Caddyfile edge routing contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CF="$REPO_ROOT/Caddyfile"
CM="$REPO_ROOT/infra/k8s/caddy-h3-configmap.yaml"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }
warn() { echo "  ⚠️  $*"; }

[[ -f "$CF" ]] || { bad "missing Caddyfile"; exit 1; }
echo "audit-rp-caddyfile ($CF)"

for mf in "$REPO_ROOT/infra/k8s/loadbalancer.yaml" "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml"; do
  [[ -f "$mf" ]] || { bad "missing $mf"; continue; }
  grep -q 'allocateLoadBalancerNodePorts: false' "$mf" \
    && ok "$(basename "$mf") MetalLB-only (allocateLoadBalancerNodePorts: false)" \
    || bad "$(basename "$mf") missing allocateLoadBalancerNodePorts: false"
  grep -qE 'nodePort:[[:space:]]*[0-9]+' "$mf" \
    && bad "$(basename "$mf") declares nodePort (forbidden for MetalLB-only edge)" \
    || ok "$(basename "$mf") no nodePort fields"
done

if [[ -f "$CM" ]]; then
  python3 - <<'PY' "$CF" "$CM"
import sys
from pathlib import Path

root = Path(sys.argv[1]).read_text()
cm_lines = Path(sys.argv[2]).read_text().splitlines()
start = next(i for i, l in enumerate(cm_lines) if l.strip() == "Caddyfile: |")
embedded = []
for l in cm_lines[start + 1 :]:
    if l and not l.startswith("    "):
        break
    embedded.append(l[4:] if len(l) >= 4 else "")
embedded_text = "\n".join(embedded)
if root.strip() != embedded_text.strip():
    print("FAIL: root Caddyfile diverges from infra/k8s/caddy-h3-configmap.yaml")
    sys.exit(1)
print("OK: root Caddyfile matches configmap")
PY
  ok "root Caddyfile matches caddy-h3-configmap.yaml"
else
  warn "missing infra/k8s/caddy-h3-configmap.yaml"
fi

grep -q 'https://record-platform.test' "$CF" && ok "primary vhost record-platform.test" \
  || bad "missing https://record-platform.test vhost"

grep -q ':443' "$CF" && grep -q '421' "$CF" && ok "fallback :443 / 421 present" \
  || bad "fallback :443 must return 421"

grep -q 'protocols h1 h2 h3' "$CF" && ok "strict h1/h2/h3 protocols" || bad "missing protocols h1 h2 h3"

grep -q 'off-campus-housing' "$CF" && bad "Caddyfile references off-campus-housing" || ok "no off-campus-housing"
grep -qE 'path /social|/social/\*|social-service' "$CF" && bad "Caddyfile references /social" || ok "no /social"
grep -qE 'path /booking|/bookings/\*|booking-service' "$CF" && bad "Caddyfile references /booking" || ok "no /booking"

if grep -q 'health_uri' "$CF"; then
  if [[ "${RP_CADDY_ALLOW_ACTIVE_HEALTH:-0}" == "1" ]]; then
    warn "active health_uri present (RP_CADDY_ALLOW_ACTIVE_HEALTH=1)"
  else
    bad "active health_uri on reverse_proxy (OCH: rely on kube readiness only)"
  fi
else
  ok "no active upstream health checks"
fi

grep -q '/_caddy/healthz' "$CF" && grep -q 'alt-svc' "$CF" && ok "/_caddy/healthz + alt-svc" \
  || bad "missing /_caddy/healthz or alt-svc"

grep -q 'X-RP-Edge-Proto' "$CF" && ok "X-RP-Edge-Proto stamped" || bad "missing X-RP-Edge-Proto"
grep -q 'X-OCH-Edge-Proto' "$CF" && grep -q 'TODO' "$CF" && ok "X-OCH-Edge-Proto with TODO compat" \
  || warn "X-OCH-Edge-Proto without TODO marker"

for p in '/api/*' '/auth/*' '/records/*' '/shopping/*' '/messaging/*' '/community/*' '/media/*' '/trust/*' '/notification/*' '/analytics/*' '/insights/*' '/ai/*' '/python-ai/*' '/auctions/*' '/auction-monitor/*'; do
  grep -qF "$p" "$CF" || bad "missing REST path $p"
done
ok "REST API path list present"

grep -qE '@listings|path /listings' "$CF" && bad "bare /listings/* route present" || ok "no bare /listings/* catch-all"

grep -q 'webapp.record-platform.svc.cluster.local:3001' "$CF" && ok "web upstream → webapp:3001 (direct Next.js)" \
  || bad "missing webapp:3001 upstream"
if grep -qE 'handle @web|@web path' "$CF" && grep -q 'nginx.record-platform.svc.cluster.local:8080' "$CF"; then
  bad "web catch-all still routes to nginx:8080"
elif grep -q 'nginx.record-platform.svc.cluster.local:8080' "$CF"; then
  warn "nginx:8080 referenced outside web catch-all"
fi
grep -qE 'handle \{|handle @web' "$CF" && ok "web catch-all handle present" || bad "missing final web handle block"

grep -q 'application/grpc' "$CF" && grep -q 'envoy-test' "$CF" && ok "gRPC Content-Type routes to envoy-test" \
  || bad "missing gRPC → envoy-test routing"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
echo "✅ audit-rp-caddyfile passed"
