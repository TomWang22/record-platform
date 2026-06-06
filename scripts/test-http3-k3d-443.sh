#!/usr/bin/env bash
# Test HTTP/2 and HTTP/3 to Caddy when using k3d 443@loadbalancer + hostPort (no NodePort).
# Run from host: ./scripts/test-http3-k3d-443.sh
#   - If host 127.0.0.1:443 is reachable (k3d published it), tests H2 and H3 from host.
#   - Always runs in-cluster test (pod -> Caddy ClusterIP) to verify QUIC path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${HOST:-record.local}"
CADDY_SVC="caddy-h3.ingress-nginx.svc.cluster.local"
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

# --- In-cluster: pod -> Caddy (ClusterIP) ---
say "=== In-cluster: HTTP/2 and HTTP/3 to Caddy (ClusterIP :443) ==="
CADDY_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
if [[ -z "$CADDY_IP" ]]; then
  warn "Caddy service not found in ingress-nginx"
else
  echo "  Caddy ClusterIP: $CADDY_IP"
  # HTTP/2 from in-cluster (any curl)
  kubectl delete job curl-h2-test -n record-platform --ignore-not-found 2>/dev/null || true
  kubectl create job curl-h2-test -n record-platform --image=curlimages/curl:latest -- \
    sh -c "curl -k -sS -o /dev/null -w '%{http_code}' -I --http2 -H 'Host: $HOST' --connect-timeout 5 https://$CADDY_SVC:443/_caddy/healthz" 2>/dev/null || true
  kubectl wait --for=condition=complete job/curl-h2-test -n record-platform --timeout=30s 2>/dev/null || true
  H2_OUT=$(kubectl logs job/curl-h2-test -n record-platform 2>/dev/null || echo "000")
  if echo "$H2_OUT" | grep -qE '200'; then
    ok "In-cluster HTTP/2: 200"
  else
    warn "In-cluster HTTP/2: $H2_OUT"
  fi
  kubectl delete job curl-h2-test -n record-platform --ignore-not-found 2>/dev/null || true

  # HTTP/3 from in-cluster (need curl with QUIC; image may take a moment to pull)
  kubectl delete job curl-h3-test -n record-platform --ignore-not-found 2>/dev/null || true
  kubectl create job curl-h3-test -n record-platform --image=alpine/curl-http3:latest -- \
    sh -c "curl -k -sS -o /dev/null -w '%{http_code}' -I --http3-only -H 'Host: $HOST' --connect-timeout 15 https://$CADDY_SVC:443/_caddy/healthz 2>&1 || echo 000" 2>/dev/null || true
  kubectl wait --for=condition=complete job/curl-h3-test -n record-platform --timeout=60s 2>/dev/null || true
  H3_OUT=$(kubectl logs job/curl-h3-test -n record-platform 2>/dev/null || echo "000")
  if echo "$H3_OUT" | grep -qE '200'; then
    ok "In-cluster HTTP/3 (QUIC): 200"
  else
    warn "In-cluster HTTP/3: $H3_OUT"
  fi
  kubectl delete job curl-h3-test -n record-platform --ignore-not-found 2>/dev/null || true
fi

# --- Host: try 127.0.0.1:PORT (443 or K3D_HOST_PORT, e.g. 8443) ---
HOST_PORT="${K3D_HOST_PORT:-443}"
say "=== Host: HTTP/2 and HTTP/3 to 127.0.0.1:${HOST_PORT} ==="
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
[[ ! -x "$CURL_BIN" ]] && CURL_BIN="curl"
# If 443 not reachable, try 8443 (default when cluster created with 8443:443@loadbalancer)
if ! nc -z 127.0.0.1 "$HOST_PORT" 2>/dev/null && [[ "$HOST_PORT" == "443" ]]; then
  if nc -z 127.0.0.1 8443 2>/dev/null; then
    HOST_PORT=8443
    info "Using 127.0.0.1:8443 (443 not reachable; cluster may have been created with 8443:443@loadbalancer)"
  fi
fi
if ! nc -z 127.0.0.1 "$HOST_PORT" 2>/dev/null; then
  warn "127.0.0.1:$HOST_PORT not reachable. Run: ./scripts/diagnose-k3d-443-host.sh"
  echo "  If 443 is in use on Mac, recreate with: K3D_HOST_HTTPS_PORT=8443 ./scripts/k3d-create-record-platform-443-lb.sh"
  echo "  Then: K3D_HOST_PORT=8443 $CURL_BIN -k -sS -I --http2 -H 'Host: $HOST' https://127.0.0.1:8443/_caddy/healthz"
  echo "        K3D_HOST_PORT=8443 $CURL_BIN -k -sS -I --http3-only -H 'Host: $HOST' --resolve '$HOST:8443:127.0.0.1' https://$HOST/_caddy/healthz"
  exit 0
fi
H2_CODE=$($CURL_BIN -k -sS -o /dev/null -w "%{http_code}" -I --http2 --max-time 5 -H "Host: $HOST" "https://127.0.0.1:${HOST_PORT}/_caddy/healthz" 2>/dev/null || echo "000")
if [[ "$H2_CODE" == "200" ]]; then
  ok "Host HTTP/2 (port $HOST_PORT): $H2_CODE"
else
  warn "Host HTTP/2: $H2_CODE"
fi
if $CURL_BIN --help all 2>/dev/null | grep -q -- '--http3'; then
  H3_CODE=$($CURL_BIN -k -sS -o /dev/null -w "%{http_code}" -I --http3-only --max-time 15 -H "Host: $HOST" --resolve "$HOST:${HOST_PORT}:127.0.0.1" "https://$HOST/_caddy/healthz" 2>/dev/null || echo "000")
  if [[ "$H3_CODE" == "200" ]]; then
    ok "Host HTTP/3 (QUIC, port $HOST_PORT): $H3_CODE"
  else
    warn "Host HTTP/3: $H3_CODE"
  fi
else
  warn "Host curl does not support --http3-only (install Homebrew curl with ngtcp2)"
fi
say "Done."
