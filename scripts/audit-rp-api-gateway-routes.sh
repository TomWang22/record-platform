#!/usr/bin/env bash
# Audit api-gateway integration: routes, targets, ports, edge, no messaging-service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONTRACT="$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/api-gateway-route-audit}"
mkdir -p "$OUT_DIR"

issues=()
warns=()
oks=()

add_issue() { issues+=("$1"); }
add_warn() { warns+=("$1"); }
add_ok() { oks+=("$1"); }

GW_SRC="$REPO_ROOT/services/api-gateway/src"
GW_MANIFEST="$GW_SRC/gateway-route-manifest.ts"
GW_SERVER="$GW_SRC/server.ts"
GW_APP="$GW_SRC/app.ts"
GW_DOCKER="$REPO_ROOT/services/api-gateway/Dockerfile"
GW_DEPLOY="$REPO_ROOT/infra/k8s/base/api-gateway/deploy.yaml"
GW_SVC="$REPO_ROOT/infra/k8s/base/api-gateway/service.yaml"
APP_CFG="$REPO_ROOT/infra/k8s/base/config/app-config.yaml"

ACTIVE_SERVICES=(
  auth-service
  records-service
  listings-service
  shopping-service
  media-service
  messaging-service
  trust-service
  notification-service
  analytics-service
  python-ai-service
  auction-monitor
)

command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

# --- Contract ports ---
while IFS= read -r line; do
  svc="${line%%:*}"
  hp="${line#*:}"
  hp="${hp%%:*}"
  [[ -z "$svc" || -z "$hp" ]] && continue
  # service slug without -service for grep patterns
  slug="${svc%-service}"
  if [[ "$svc" == "api-gateway" ]]; then
    grep -qE 'GATEWAY_PORT: "4000"|containerPort: 4000|port: 4000|EXPOSE 4000' \
      "$GW_DEPLOY" "$GW_SVC" "$GW_DOCKER" "$APP_CFG" 2>/dev/null \
      && add_ok "api-gateway listens/exposes 4000" \
      || add_issue "api-gateway not consistently on port 4000 (contract $hp)"
    grep -rq '"/healthz"' "$GW_SRC/health.ts" "$GW_APP" 2>/dev/null && add_ok "/healthz in gateway source" || add_issue "missing /healthz in api-gateway"
    grep -rq '"/readyz"' "$GW_SRC/health.ts" "$GW_APP" 2>/dev/null && add_ok "/readyz in gateway source" || add_issue "missing /readyz in api-gateway"
    [[ -f "$GW_MANIFEST" ]] && add_ok "gateway-route-manifest.ts present" || add_issue "missing gateway-route-manifest.ts"
    srv_lines=$(wc -l <"$GW_SERVER" | tr -d ' ')
    [[ "$srv_lines" -le 15 ]] && add_ok "server.ts is thin entrypoint ($srv_lines lines)" || add_issue "server.ts monolith ($srv_lines lines); must only listen"
    continue
  fi

  # HTTP target in gateway sources
  if grep -rq "$svc" "$GW_SRC" 2>/dev/null \
    && grep -rq ":$hp" "$GW_SRC" 2>/dev/null; then
    add_ok "gateway references $svc:$hp"
  elif grep -rq "$svc" "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" 2>/dev/null \
    && grep -rq "${slug^^}_HTTP\|${svc^^}\|MESSAGING_HTTP\|TRUST_HTTP\|MEDIA_HTTP\|NOTIFICATION_HTTP" "$GW_SRC" 2>/dev/null; then
    add_ok "gateway references $svc via env proxy (marketplace-http-proxies or app-config)"
  else
    add_issue "gateway missing HTTP target for $svc (contract port $hp)"
  fi
done < <(python3 - <<'PY'
import json
from pathlib import Path
c = json.loads(Path("infra/contracts/rp-service-runtime-contract.json").read_text())
# Not proxied through api-gateway HTTP (sidecar, ML stack, web frontend).
skip = {"webapp", "transport-watchdog", "ollama", "ollama-gateway", "ollama-worker"}
for name, spec in c["services"].items():
    if name in skip:
        continue
    if spec.get("dockerfile") is None and spec.get("deployment") is None:
        continue
    hp = spec.get("httpPort")
    print(f"{name}:{hp if hp is not None else ''}:")
PY
)

# --- Stale social / booking / wrong ports ---
grep -rn 'analytics-service:4004\|http://analytics-service:4017' "$GW_SRC" 2>/dev/null \
  | grep -v 'service-targets\|ANALYTICS_HTTP_TARGET\|gateway-route-manifest' \
  && add_issue "hardcoded analytics URL (use ANALYTICS_HTTP_TARGET)" || add_ok "no hardcoded stale analytics URLs"

grep -rn 'http://analytics-service:4017' "$GW_SRC" 2>/dev/null \
  | grep -v 'service-targets\|ANALYTICS_HTTP_TARGET' \
  && add_issue "hardcoded analytics-service:4017 (use ANALYTICS_HTTP_TARGET)" || true

grep -rn 'auth-service:4011' "$GW_SRC" 2>/dev/null \
  && add_issue "stale auth HTTP port 4011 (contract 4001)" || add_ok "no auth:4011 in gateway"

grep -rn ':4020' "$GW_SRC" "$GW_DEPLOY" "$GW_SVC" 2>/dev/null \
  && add_issue "stale port 4020 in gateway manifests/source" || add_ok "no :4020 in gateway"

# --- Caddy / haproxy / webapp ---
if [[ -f "$REPO_ROOT/infra/k8s/base/haproxy/configmap.yaml" ]]; then
  grep -q 'api-gateway.record-platform.svc.cluster.local:4000' "$REPO_ROOT/infra/k8s/base/haproxy/configmap.yaml" \
    && add_ok "haproxy upstream api-gateway:4000" \
    || add_warn "haproxy may not point to api-gateway:4000"
fi
if grep -rq 'record-platform.test' "$REPO_ROOT/infra/k8s/overlays/dev" 2>/dev/null; then
  add_ok "dev overlay references record-platform.test"
fi
grep -q 'api-gateway.record-platform.svc.cluster.local:4000' "$REPO_ROOT/infra/k8s/base/webapp/deploy.yaml" 2>/dev/null \
  && add_ok "webapp gateway URL :4000" || add_warn "webapp gateway URL not :4000"

# transport-watchdog
grep -q '127.0.0.1:4000' "$GW_DEPLOY" 2>/dev/null \
  && add_ok "transport-watchdog uses :4000" \
  || add_issue "transport-watchdog not on 127.0.0.1:4000"

# marketplace proxies
for key in MESSAGING_HTTP TRUST_HTTP MEDIA_HTTP NOTIFICATION_HTTP; do
  grep -q "$key" "$REPO_ROOT/services/api-gateway/src/proxy/marketplace-routes.ts" 2>/dev/null \
    && add_ok "marketplace-http-proxies defines $key" \
    || add_issue "marketplace-http-proxies missing $key"
done

mp_count=$(grep -h 'registerMarketplaceHttpProxies' "$GW_APP" "$GW_SRC/proxy/marketplace-routes.ts" 2>/dev/null | wc -l | tr -d ' ')
[[ "${mp_count:-0}" -ge 1 ]] && add_ok "registerMarketplaceHttpProxies wired" || add_issue "registerMarketplaceHttpProxies not called"

for gid in auth records listings shopping messaging media trust notification analytics python-ai auction-monitor; do
  grep -q "id: \"$gid\"" "$GW_MANIFEST" 2>/dev/null \
    && add_ok "manifest group $gid" \
    || add_issue "gateway-route-manifest missing $gid"
done

if grep -rn 'messaging-service' "$GW_SRC" --exclude='*test*' 2>/dev/null | grep -vE 'removed|legacy|RP_SKIP|RP_ENABLE|308|redirect|/\*\*|//|__tests__'; then
  add_issue "messaging-service reference in gateway source"
else
  add_ok "no messaging-service upstream in gateway"
fi

grep -rq 'reservation-mesh' "$GW_SRC" "$APP_CFG" 2>/dev/null \
  && add_issue "reservation-mesh reference in active gateway" || add_ok "no reservation-mesh in gateway"

status="pass"
[[ ${#issues[@]} -gt 0 ]] && status="fail"

{
  echo "# API gateway route audit"
  echo ""
  echo "Status: **$status**"
  echo ""
  echo "## Issues (${#issues[@]})"
  for i in "${issues[@]:-}"; do echo "- $i"; done
  echo ""
  echo "## Warnings (${#warns[@]})"
  for w in "${warns[@]:-}"; do echo "- $w"; done
  echo ""
  echo "## OK (${#oks[@]})"
  for o in "${oks[@]:-}"; do echo "- $o"; done
} >"$OUT_DIR/report.md"

python3 - <<PY
import json
from pathlib import Path
Path("$OUT_DIR/report.json").write_text(json.dumps({
  "status": "$status",
  "issues": $(printf '%s\n' "${issues[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))'),
  "warnings": $(printf '%s\n' "${warns[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))'),
}, indent=2) + "\n")
PY

echo "Report: $OUT_DIR/report.md"
if [[ "$status" == "fail" ]]; then
  echo "❌ api-gateway route audit failed (${#issues[@]} issues)" >&2
  exit 1
fi
echo "✅ api-gateway route audit passed"
