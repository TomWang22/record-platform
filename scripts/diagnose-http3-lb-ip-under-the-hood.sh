#!/usr/bin/env bash
# Diagnose HTTP/3 via LB IP: host listeners, socat log, Colima path, VM listener, optional tcpdump, one curl.
# Run when HTTP/3 to LB IP fails (exit 7/28/55). No sudo required except for tcpdump (or use CAPTURE=0).
# Usage: LB_IP=192.168.106.240 NODEPORT=30443 ./scripts/diagnose-http3-lb-ip-under-the-hood.sh
#        CAPTURE=1  (default) = run tcpdump on lo0 while one curl; CAPTURE=0 = skip (no sudo).
# See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md and docs/HTTP3-CURL-EXIT-CODES.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LB_IP="${LB_IP:-}"
NODEPORT="${NODEPORT:-30443}"
CAPTURE="${CAPTURE:-1}"
HOST="${HOST:-record.local}"
CURL_HTTP3="${CURL_HTTP3:-}"
UDP_LOG="${TMPDIR:-/tmp}/lb-ip-socat-udp.log"
METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
section() { printf "\n\033[1m=== %s ===\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# Detect LB_IP from cluster or env file
if [[ -z "$LB_IP" ]] && [[ -f "$METALLB_ENV" ]]; then
  # shellcheck source=/dev/null
  source "$METALLB_ENV" 2>/dev/null || true
  LB_IP="${REACHABLE_LB_IP:-$LB_IP}"
fi
if [[ -z "$LB_IP" ]] && command -v kubectl >/dev/null 2>&1; then
  LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  [[ -z "$LB_IP" ]] && LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.externalIPs[0]}' 2>/dev/null || true)
fi
if [[ -z "$LB_IP" ]]; then
  echo "❌ LB_IP not set. Export LB_IP=... or run setup-lb-ip-host-access.sh first."
  exit 1
fi

# Curl with HTTP/3
_curl_has_http3() { [[ -x "${1:-}" ]] && "$1" --help all 2>/dev/null | grep -q -- "--http3"; }
if [[ -z "$CURL_HTTP3" ]]; then
  _curl_has_http3 /opt/homebrew/opt/curl/bin/curl && CURL_HTTP3="/opt/homebrew/opt/curl/bin/curl"
  [[ -z "$CURL_HTTP3" ]] && _curl_has_http3 /usr/local/opt/curl/bin/curl && CURL_HTTP3="/usr/local/opt/curl/bin/curl"
  [[ -z "$CURL_HTTP3" ]] && _curl_has_http3 "$(command -v curl 2>/dev/null)" && CURL_HTTP3="$(command -v curl)"
fi
unset -f _curl_has_http3 2>/dev/null || true

# Colima binary
COLIMA_CMD="${COLIMA_BIN:-$(command -v colima 2>/dev/null)}"
[[ -z "$COLIMA_CMD" ]] && [[ -x /opt/homebrew/bin/colima ]] && COLIMA_CMD="/opt/homebrew/bin/colima"
[[ -z "$COLIMA_CMD" ]] && [[ -x /usr/local/bin/colima ]] && COLIMA_CMD="/usr/local/bin/colima"

echo "HTTP/3 via LB IP diagnostic — LB_IP=$LB_IP NODEPORT=$NODEPORT HOST=$HOST"
echo "Curl (HTTP/3): ${CURL_HTTP3:-none}"

# --- (0) Host: who is listening on UDP 443 and UDP 30443 ---
section "0. Host listeners (UDP 443 and UDP 30443)"
info "UDP 443 (socat should bind to $LB_IP:443):"
if lsof -i UDP:443 2>/dev/null | head -20; then :; else
  echo "  (none or need sudo: sudo lsof -i UDP:443)"
  warn "No listener on UDP 443 — HTTP/3 to LB IP will get 'connection refused'. Run: LB_IP=$LB_IP NODEPORT=$NODEPORT ./scripts/setup-lb-ip-host-access.sh"
fi
info "UDP $NODEPORT (Colima forwarder or k3d should listen so 443→30443 chain works):"
if lsof -i UDP:"$NODEPORT" 2>/dev/null | head -20; then :; else echo "  (none or need sudo: sudo lsof -i UDP:$NODEPORT)"; fi

# --- (1) Socat UDP 443 log ---
section "1. Socat UDP 443 log (last 30 lines)"
LOG_OTHER_IP=""
if [[ -f "$UDP_LOG" ]]; then
  tail -30 "$UDP_LOG" || true
  # Detect bind to a different IP than current LB_IP (stale socat or wrong run)
  LOG_OTHER_IP=$(grep -oE 'AF=2 [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:443' "$UDP_LOG" 2>/dev/null | tail -1 | sed 's/AF=2 //;s/:443//')
  if [[ -n "$LOG_OTHER_IP" ]] && [[ "$LOG_OTHER_IP" != "$LB_IP" ]]; then
    warn "Log shows bind to $LOG_OTHER_IP but you are using LB_IP=$LB_IP — stale socat or old run. Kill UDP 443 holders and re-run setup with LB_IP=$LB_IP"
  fi
else
  info "No log at $UDP_LOG (socat may not be running or log is elsewhere)"
fi

# --- (2) Colima: VM IP and forwarder target ---
section "2. Colima path (host 127.0.0.1:$NODEPORT → VM:?)"
if [[ -n "$COLIMA_CMD" ]] && [[ -x "$COLIMA_CMD" ]]; then
  info "Colima VM 'ip route get 1.1.1.1' (raw — check if field 7 is gateway vs src):"
  "$COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null || true
  _src_awk='/(^| )src /{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}'
  VM_SRC=$("$COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk "$_src_awk" || true)
  VM_F7=$("$COLIMA_CMD" ssh -- ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)
  info "Parsed: VM src (preferred)=${VM_SRC:-<none>}  field7=${VM_F7:-<none>}"
  if [[ -f "$METALLB_ENV" ]]; then
    # shellcheck source=/dev/null
    source "$METALLB_ENV" 2>/dev/null || true
    info "Forwarder target from last setup: COLIMA_IP=${COLIMA_IP:-<not set>}"
    if [[ -n "${COLIMA_IP:-}" ]]; then
      if [[ -n "$VM_SRC" ]] && [[ "$COLIMA_IP" != "$VM_SRC" ]]; then
        warn "COLIMA_IP ($COLIMA_IP) != VM src ($VM_SRC). If $COLIMA_IP is the gateway, forwarder sends to wrong host. Re-run setup so it uses src."
      fi
    fi
  fi
else
  info "Colima not found or not executable; skipping VM path"
fi

# --- (3) In-VM: is UDP 30443 listening? Can Caddy answer QUIC locally? ---
section "3. In-VM listener and QUIC (NodePort 30443 UDP)"
SS_30443=""
if [[ -n "$COLIMA_CMD" ]] && [[ -x "$COLIMA_CMD" ]]; then
  info "ss -ulnp | grep $NODEPORT:"
  SS_30443=$("$COLIMA_CMD" ssh -- ss -ulnp 2>/dev/null | grep "$NODEPORT" || true)
  echo "$SS_30443" | sed 's/^/  /'
  if echo "$SS_30443" | grep -q "docker-proxy"; then
    warn "NodePort $NODEPORT is bound by docker-proxy (k3d). docker-proxy does NOT properly support QUIC — that is the root cause of HTTP/3 failure. See docs/HTTP3-K3D-DOCKER-PROXY.md"
  fi
  info "/proc/net/udp (76EB = 30443):"
  "$COLIMA_CMD" ssh -- cat /proc/net/udp 2>/dev/null | grep -E "76EB|30443" || echo "  (no match)"
  info "In-VM HTTP/3 to 127.0.0.1:$NODEPORT (if curl has --http3 in VM):"
  VM_H3=$("$COLIMA_CMD" ssh -- bash -c "command -v curl >/dev/null && curl --help all 2>/dev/null | grep -q -- '--http3' && NGTCP2_ENABLE_GSO=0 curl --http3-only -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 https://127.0.0.1:$NODEPORT/_caddy/healthz -H 'Host: $HOST' 2>/dev/null || echo 'no-http3'" 2>/dev/null) || true
  if [[ "$VM_H3" == "200" ]]; then
    ok "VM HTTP/3 to 127.0.0.1:$NODEPORT: $VM_H3 (Caddy answers QUIC in VM; issue is likely host→VM path)"
  elif [[ -n "$VM_H3" ]]; then
    info "VM HTTP/3 result: $VM_H3"
  fi
else
  info "Colima not available; run manually: colima ssh -- ss -ulnp | grep 30443"
fi

# --- (4) Optional tcpdump on lo0 while one curl ---
section "4. Packet capture (lo0 UDP 443) while one HTTP/3 request"
if [[ "$CAPTURE" == "1" ]] && command -v tcpdump >/dev/null 2>&1; then
  CAP_FILE="${TMPDIR:-/tmp}/diagnose-http3-lo0-$$.pcap"
  info "tcpdump -i lo0 udp port 443 for 10s (may need: sudo $0); then one curl to $LB_IP..."
  tcpdump -i lo0 -c 500 -w "$CAP_FILE" udp port 443 2>/dev/null &
  TCPDUMP_PID=$!
  sleep 1
  if [[ -n "$CURL_HTTP3" ]]; then
    NGTCP2_ENABLE_GSO=0 "$CURL_HTTP3" --http3-only -k -sS -o /dev/null -w 'curl exit=%{http_code}\n' --connect-timeout 5 --max-time 8 --resolve "$HOST:443:$LB_IP" "https://$HOST/_caddy/healthz" 2>&1 || true
  else
    info "No HTTP/3 curl; skipping request during capture"
  fi
  sleep 4
  kill "$TCPDUMP_PID" 2>/dev/null || true
  wait "$TCPDUMP_PID" 2>/dev/null || true
  if [[ -f "$CAP_FILE" ]]; then
    CNT=$(tcpdump -r "$CAP_FILE" 2>/dev/null | wc -l)
    info "Packets captured on lo0 UDP 443: $CNT"
    [[ "$CNT" -eq 0 ]] && warn "No UDP 443 packets on lo0 — traffic not reaching the host listener (or curl didn't send QUIC to $LB_IP)"
    rm -f "$CAP_FILE"
  fi
else
  info "CAPTURE=0 or tcpdump not found; skip. (Use sudo if tcpdump permission denied.)"
fi

# --- (5) One verbose HTTP/3 curl ---
section "5. One HTTP/3 request (exit code + timing)"
if [[ -n "$CURL_HTTP3" ]]; then
  info "Command: NGTCP2_ENABLE_GSO=0 $CURL_HTTP3 --http3-only -k -v --connect-timeout 6 --max-time 10 --resolve $HOST:443:$LB_IP https://$HOST/_caddy/healthz"
  set +e
  NGTCP2_ENABLE_GSO=0 "$CURL_HTTP3" --http3-only -k -v --connect-timeout 6 --max-time 10 --resolve "$HOST:443:$LB_IP" "https://$HOST/_caddy/healthz" 2>&1 | tail -40
  CURL_EXIT=$?
  set -e
  info "Curl exit code: $CURL_EXIT (7=refused, 28=timeout, 55=send failure)"
else
  warn "Install Homebrew curl (brew install curl) for HTTP/3; then re-run this script"
fi

# --- 6. Next: packet truth (where does QUIC die?) ---
section "6. Next: packet truth (run these to find where QUIC dies)"
echo "Forwarder targets VM ($NODEPORT). If HTTP/3 still 000, one of: UDP dropped host→VM, NodePort UDP broken, or Caddy not replying."
echo ""
echo "A) In VM: see if packets arrive (run in another terminal, then run curl from host once):"
echo "  colima ssh -- sudo tcpdump -ni any udp port $NODEPORT"
echo "  # Then: NGTCP2_ENABLE_GSO=0 ${CURL_HTTP3:-/opt/homebrew/opt/curl/bin/curl} --http3-only -k --resolve $HOST:443:$LB_IP https://$HOST/_caddy/healthz"
echo "  → Packets seen: Mac→VM path OK; problem is NodePort→Pod or Caddy QUIC."
echo "  → No packets: Colima/firewall dropping UDP or host→VM path broken."
echo ""
echo "B) In-VM NodePort QUIC (does Caddy answer on 127.0.0.1:$NODEPORT?):"
echo "  colima ssh -- bash -c 'NGTCP2_ENABLE_GSO=0 curl --http3-only -k -sS -o /dev/null -w \"%{http_code}\" --connect-timeout 5 --resolve $HOST:$NODEPORT:127.0.0.1 https://$HOST:$NODEPORT/_caddy/healthz'"
echo "  → 200: NodePort + Caddy QUIC OK; issue is host→VM. → 000: kube-proxy or Caddy QUIC not responding."
echo ""
echo "C) NodePort must bind 0.0.0.0:$NODEPORT, not 127.0.0.1:"
echo "  colima ssh -- sudo ss -ulnp | grep $NODEPORT"
echo "  → If Local is 127.0.0.1:$NODEPORT, NodePort is not reachable from host forwarder."
echo ""
echo "D) NAT and conntrack (inside VM):"
echo "  colima ssh -- sudo iptables -t nat -L -n | grep $NODEPORT"
echo "  colima ssh -- sudo conntrack -L -p udp 2>/dev/null | grep $NODEPORT || true"
echo "  → No DNAT for UDP $NODEPORT: kube-proxy didn't program NodePort. No conntrack during curl: packet never arrived."

# --- Interpretation ---
section "Interpretation"
echo "• Exit 7 (refused): Nothing listening on next hop (UDP 443 on host, or UDP $NODEPORT, or VM NodePort)."
echo "• Exit 28 (timeout): Packets may be sent but no QUIC response (wrong VM IP, firewall, or Caddy not answering QUIC)."
echo "• If COLIMA_IP is the gateway not the VM's own IP, forwarder sends to wrong host. Re-run setup; see step 2."
if [[ -n "$LOG_OTHER_IP" ]] && [[ "$LOG_OTHER_IP" != "$LB_IP" ]]; then
  echo "• Log shows bind failures for $LOG_OTHER_IP but LB_IP=$LB_IP: kill any stale socat (sudo kill -9 \$(lsof -t -i UDP:443)), then run setup with LB_IP=$LB_IP so UDP 443 binds to the correct alias."
fi
echo "• Fix: (1) Run setup-lb-ip-host-access.sh with LB_IP=$LB_IP. (2) Colima forwarder must target VM IP (src, e.g. 192.168.5.1), not gateway (.2). (3) In VM: ss -ulnp | grep 30443 must show listener."
echo "• Do NOT use COLIMA_IP_OVERRIDE=192.168.5.2 — that is the gateway; UDP would go to wrong host. Use VM src (192.168.5.1) or re-run setup without override so script auto-detects src."
if echo "${SS_30443:-}" | grep -q "docker-proxy"; then
  echo "• ROOT CAUSE: NodePort UDP is handled by docker-proxy (k3d). docker-proxy does not properly support QUIC. Fix: use hostPort 443 + loadbalancer publish (--port 443:443/udp@loadbalancer), or Colima k3s without k3d. See docs/HTTP3-K3D-DOCKER-PROXY.md"
fi
say "Done."
