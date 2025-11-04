#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-record.local}"
NS_ING=ingress-nginx
NS_APP=record-platform
INGCTL="ingress-nginx-controller.${NS_ING}.svc.cluster.local"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
fail() { echo "❌ $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }

# --- Sanity: namespaces ---
kubectl get ns "${NS_ING}" >/dev/null 2>&1 || fail "Namespace ${NS_ING} missing"
kubectl get ns "${NS_APP}" >/dev/null 2>&1 || fail "Namespace ${NS_APP} missing"

# --- Caddy up? ---
say "Checking Caddy (_caddy/healthz) from your Mac (H2/H3)…"
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 "https://${HOST}:8443/_caddy/healthz" | head -n1 | grep -q "200"; then
  ok "Caddy H2 OK"
else
  fail "Caddy H2 failed"
fi
if /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only "https://${HOST}:8443/_caddy/healthz" | head -n1 | grep -q "200"; then
  ok "Caddy H3 OK"
else
  echo "⚠️  Caddy H3 failed; macOS firewall may block UDP 8443. We'll continue."
fi

# --- Ingress rule present? ---
say "Checking Ingress rule (record-platform)…"
kubectl -n "${NS_APP}" get ingress record-platform -o yaml >/dev/null || fail "Ingress record-platform missing"
ok "Ingress exists"

# --- App service and endpoints? ---
say "Checking api-gateway Service + endpoints…"
kubectl -n "${NS_APP}" get svc api-gateway -o wide || fail "Service api-gateway missing"
EP_JSON="$(kubectl -n "${NS_APP}" get endpointslices.discovery.k8s.io -l kubernetes.io/service-name=api-gateway -o json)"
ADDRS="$(echo "${EP_JSON}" | jq '[.items[].endpoints[].addresses[]] | length' 2>/dev/null || echo 0)"
if [[ "${ADDRS}" -gt 0 ]]; then
  ok "api-gateway has ${ADDRS} endpoint address(es)"
else
  kubectl -n "${NS_APP}" get pods -o wide
  kubectl -n "${NS_APP}" describe svc api-gateway
  fail "api-gateway has 0 endpoints (NGINX returns 502 in this case). Make sure the Deployment is Running/Ready and selector matches."
fi

# --- In-cluster probe straight to ingress (TLS; ignore cert with -k) ---
say "Probing ingress from inside cluster (TLS to ${INGCTL}, Host=${HOST})…"
kubectl -n "${NS_ING}" run curl-probe --rm -it --restart=Never --image=curlimages/curl:8.10.1 -- \
  curl -k -sS -I -H "Host: ${HOST}" "https://${INGCTL}/api/healthz" | tr -d '\r' | head -n2 || true

# Extract status code
STATUS="$(kubectl -n "${NS_ING}" run curl-probe2 --rm -it --restart=Never --image=curlimages/curl:8.10.1 -- \
  sh -lc 'curl -k -s -o /dev/null -w "%{http_code}" -H "Host: '"${HOST}"'" https://'"${INGCTL}"'/api/healthz' 2>/dev/null || true)"
if [[ "${STATUS}" == "200" ]]; then
  ok "Ingress -> api-gateway works from inside cluster"
else
  echo "⚠️  Ingress returned HTTP ${STATUS} in-cluster."
fi

# If in-cluster is OK but Mac via Caddy is 502, it’s almost certainly upstream TLS trust.
say "Testing Mac → Ingress (bypassing Caddy) via NodePort forward (ephemeral)…"
# Port-forward ingress service 8444->443 temporarily
kubectl -n "${NS_ING}" port-forward svc/ingress-nginx-controller 8444:443 >/dev/null 2>&1 &
PF_PID=$!
sleep 1
MAC_STATUS="$(/opt/homebrew/opt/curl/bin/curl -k -s -o /dev/null -w "%{http_code}" -H "Host: ${HOST}" https://127.0.0.1:8444/api/healthz || true)"
kill ${PF_PID} >/dev/null 2>&1 || true

if [[ "${MAC_STATUS}" == "200" ]]; then
  ok "Mac → Ingress is fine. The remaining issue is Caddy → Ingress (likely upstream TLS trust)."
  NEED_HTTP_FIX="1"
else
  echo "⚠️  Mac → Ingress returned HTTP ${MAC_STATUS}. We still may have an ingress rule/backend issue."
  NEED_HTTP_FIX="1"
fi

# --- Optional fix: switch Caddy → Ingress to HTTP upstream for dev ---
if [[ "${NEED_HTTP_FIX:-}" == "1" ]]; then
  say "Applying DEV fix: Caddy reverse_proxy to ingress over HTTP:80 (no upstream TLS)…"
  cat > /tmp/Caddyfile.http-upstream <<'EOF'
{
  admin off
}

https://record.local {
  tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key

  @health path /_caddy/healthz
  respond @health "ok\n" 200

  # DEV: HTTP to ingress to avoid CA/SNI issues inside cluster
  reverse_proxy http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80 {
    header_up Host {http.request.host}
  }
}

https://:443 {
  tls /etc/caddy/certs/tls.crt /etc/caddy/certs/tls.key
  @probe path /_caddy/healthz
  respond @probe "ok\n" 200
}
EOF

  kubectl -n "${NS_ING}" create configmap caddy-h3 \
    --from-file=Caddyfile=/tmp/Caddyfile.http-upstream \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "${NS_ING}" rollout restart deploy/caddy-h3
  kubectl -n "${NS_ING}" rollout status  deploy/caddy-h3

  say "Re-test via Caddy:"
  /opt/homebrew/opt/curl/bin/curl -k -sS -I --http2      -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" | head -n1 || true
  /opt/homebrew/opt/curl/bin/curl -k -sS -I --http3-only -H "Host: ${HOST}" "https://${HOST}:8443/api/healthz" | head -n1 || true
  ok "If you now see 200, the root cause was upstream TLS trust. Keep HTTP in dev, or switch back to TLS once CA trust is configured."
fi

say "Done."
