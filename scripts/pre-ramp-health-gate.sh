#!/usr/bin/env bash
# Pre-ramp health gate: fail ramp if cluster/ingress/QUIC are not alive.
# Prevents wasting a full ramp when k3s died, Caddy is down, or QUIC is blackholed.
#
# Checks:
#  1. All nodes Ready
#  2. Ingress (Caddy) pods Running in ingress-nginx
#  3. At least one service exposing 443 (LoadBalancer or NodePort)
#  4. Active QUIC probe: curl --http3 -k https://<target>/_caddy/healthz → 200
#
# Usage:
#   ./scripts/pre-ramp-health-gate.sh
#   QUIC_PROBE_URL=https://192.168.64.240/_caddy/healthz ./scripts/pre-ramp-health-gate.sh
#   SKIP_QUIC_PROBE=1 ./scripts/pre-ramp-health-gate.sh   # skip curl (e.g. no curl-http3)
#
# Env:
#   QUIC_PROBE_URL  — URL for HTTP/3 health (default https://${K6_LB_IP}/_caddy/healthz)
#   K6_LB_IP       — LB IP for ramp (default 192.168.64.240); used for probe if QUIC_PROBE_URL unset
#   SKIP_QUIC_PROBE — set to 1 to skip the curl check
#   QUIC_PROBE_REPEAT — run probe this many times in a row; all must return 200 (default 1). Use 10 to enforce "stable 10 in a row" before ramp.
#   QUIC_PROBE_RETRIES — per-probe retry count (default 3). Each of the N probes may be retried this many times with 2s backoff before failing.
#   QUIC_PROBE_DELAY_SEC — seconds to wait before first probe (default 3 when repeat>1, 0 otherwise). Lets cold UDP path settle.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Canonical H3 env: same defaults as run-h3-ramp.sh / run-transport-validation.sh. Export so QUIC probe and any child use them.
K6_LB_IP="${K6_LB_IP:-192.168.64.240}"
export K6_LB_IP
QUIC_PROBE_URL="${QUIC_PROBE_URL:-https://${K6_LB_IP}/_caddy/healthz}"
SKIP_QUIC_PROBE="${SKIP_QUIC_PROBE:-0}"
QUIC_PROBE_REPEAT="${QUIC_PROBE_REPEAT:-1}"
QUIC_PROBE_RETRIES="${QUIC_PROBE_RETRIES:-3}"

fail() {
  echo "❌ Pre-ramp health gate failed: $*" >&2
  echo "   Fix cluster/ingress/QUIC before running ramp. See docs/TRANSPORT_BENCHMARKING_V5.md (Pre-ramp checklist)." >&2
  exit 1
}

ok() { echo "✅ $*"; }

echo "=== Pre-ramp health gate ==="

# 1. Nodes Ready
if ! kubectl get nodes --no-headers 2>/dev/null | awk '{ print $2 }' | grep -q .; then
  fail "Cannot get nodes (kubectl unreachable or no nodes). Run ./scripts/colima-forward-6443.sh and ensure k3s is up."
fi
not_ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 != "Ready" { print $1 }' || true)
if [[ -n "$not_ready" ]]; then
  fail "Node(s) not Ready: $not_ready"
fi
ok "Nodes Ready"

# 2. Ingress (Caddy) pods Running
caddy_count=$(kubectl get pods -n ingress-nginx -l app=caddy-h3 --no-headers 2>/dev/null | grep -c "Running" || true)
if [[ "${caddy_count:-0}" -eq 0 ]]; then
  fail "No Caddy (caddy-h3) pods Running in ingress-nginx. Check: kubectl get pods -n ingress-nginx"
fi
ok "Caddy pods Running ($caddy_count)"

# 3. Something exposing 443
svc_443=$(kubectl get svc -A --no-headers 2>/dev/null | grep -E "443| LoadBalancer| NodePort" || true)
if [[ -z "$svc_443" ]]; then
  fail "No service exposing 443 (grep 443 / LoadBalancer / NodePort). Check: kubectl get svc -A | grep 443"
fi
ok "Service(s) on 443"

# 4. Active QUIC probe (HTTP/3 200)
if [[ "$SKIP_QUIC_PROBE" == "1" ]]; then
  ok "QUIC probe skipped (SKIP_QUIC_PROBE=1)"
else
  CURL_BIN=""
  for _c in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl "$(command -v curl 2>/dev/null)"; do
    [[ -x "${_c:-}" ]] && "$_c" --help all 2>/dev/null | grep -q -- "--http3" && CURL_BIN="$_c" && break
  done
  if [[ -z "$CURL_BIN" ]]; then
    echo "⚠️  No curl with HTTP/3 (--http3 or --http3-only); skipping QUIC probe. Set SKIP_QUIC_PROBE=1 to silence." >&2
  else
    # Prefer --http3-only (no fallback to H2); fallback to --http3
    H3_FLAG="--http3"
    "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only" && H3_FLAG="--http3-only"
    repeat="${QUIC_PROBE_REPEAT:-1}"
    retries="${QUIC_PROBE_RETRIES:-3}"
    # Short delay before first probe when doing multiple (lets cold UDP path settle)
    delay_sec=0
    [[ "$repeat" -gt 1 ]] && delay_sec="${QUIC_PROBE_DELAY_SEC:-3}"
    [[ "$delay_sec" -gt 0 ]] && echo "  Waiting ${delay_sec}s before first QUIC probe..." && sleep "$delay_sec"
    for i in $(seq 1 "$repeat"); do
      got_200=0
      for attempt in $(seq 1 "$retries"); do
        if "$CURL_BIN" -sS "$H3_FLAG" -k --connect-timeout 5 --max-time 15 "$QUIC_PROBE_URL" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q 200; then
          got_200=1
          break
        fi
        [[ $attempt -lt $retries ]] && sleep 2
      done
      if [[ "$got_200" -ne 1 ]]; then
        fail "QUIC probe $i/$repeat did not return 200 after ${retries} attempts: $QUIC_PROBE_URL ($CURL_BIN $H3_FLAG). Ingress may be down or UDP 443 blackholed (intermittent QUIC = NAT/conntrack?)."
      fi
      [[ $i -lt $repeat ]] && sleep 1
    done
    ok "QUIC probe 200 at $QUIC_PROBE_URL$([[ "$repeat" -gt 1 ]] && echo " (${repeat}x in a row)")"
  fi
fi

echo "=== Health gate passed. Safe to run ramp ==="
