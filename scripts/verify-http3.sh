#!/usr/bin/env bash
# Edge HTTP/3 validation: prefer curl --http3 + http_version=3; accept alt-svc advertising h3 (QUIC advertised).
# Does not change Caddy — validation only.
#
# Env:
#   OCH_EDGE_HOSTNAME — default record-platform.test
#   VERIFY_HTTP3_URL — full URL override (default https://$HOST/)
#   VERIFY_HTTP3_CACERT — PEM path (default dev-chain.pem, else dev-root.pem); if missing, uses -k
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${OCH_EDGE_HOSTNAME:-record-platform.test}"
URL="${VERIFY_HTTP3_URL:-https://${HOST}/}"
if [[ -z "${VERIFY_HTTP3_CACERT:-}" ]]; then
  if [[ -f "$REPO_ROOT/certs/dev-chain.pem" ]]; then
    CA="$REPO_ROOT/certs/dev-chain.pem"
  else
    CA="$REPO_ROOT/certs/dev-root.pem"
  fi
else
  CA="$VERIFY_HTTP3_CACERT"
fi
CURL=(curl -sS --connect-timeout 8 --max-time 35)
if [[ -f "$CA" ]]; then
  CURL+=(--cacert "$CA")
else
  CURL+=(-k)
fi

echo "verify-http3: probing ${URL} (curl --http3, http_version)"

ver="$("${CURL[@]}" --http3 -o /dev/null -w "%{http_version}" "$URL" 2>/dev/null || echo "")"
if [[ "$ver" == "3" ]]; then
  echo "✅ HTTP/3 OK (curl http_version=3)"
  exit 0
fi

echo "verify-http3: primary probe did not report HTTP/3 (http_version=${ver:-empty}); checking alt-svc…"

if "${CURL[@]}" -I --max-time 25 "$URL" 2>/dev/null | grep -i '^alt-svc:' | grep -qi 'h3'; then
  echo "✅ HTTP/3 OK (alt-svc advertises h3 — QUIC offered; client may negotiate HTTP/3)"
  exit 0
fi

echo "❌ HTTP/3 validation failed: no http_version=3 and no alt-svc h3=" >&2
exit 1
