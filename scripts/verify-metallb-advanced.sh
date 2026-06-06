#!/usr/bin/env bash
# MetalLB advanced verification: BGP mode, route flaps, ARP poisoning simulation, asymmetric routing, multi-subnet failover.
# Run by default after verify-metallb-and-traffic-policy.sh when METALLB_ENABLED=1. Set SKIP_METALLB_ADVANCED=1 to skip.
#
# Use: ./scripts/verify-metallb-advanced.sh
#   LB_IP=192.168.106.241   reuse LB IP from main verification (optional)
#   CURL_IMG=...            image for curl pods (default: curlimages/curl:latest; HTTP/1.1 and HTTP/2 only; for HTTP/3 use an image with QUIC support, e.g. rmarx/curl-http3 or alpine/curl-http3)
#   SKIP_BGP=1              skip BGP check (default: run; skips if no BGPPeer)
#   SKIP_ROUTE_FLAPS=1      skip route-flap injection (default: run)
#   SKIP_ARP_SIM=1          skip ARP poisoning simulation (default: run where safe)
#   SKIP_ASYMMETRIC=1       skip asymmetric routing test (default: run)
#   SKIP_HAIRPIN=1          skip hairpin test (pod → LB IP; default: run)
#   HAIRPIN_RETRY=0         disable Colima hairpin retry (default: 1 = retry once if first attempt 000)
#   SKIP_MULTI_SUBNET=1     skip multi-subnet failover (default: run; skips if single pool)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS_METALLB="${NS_METALLB:-metallb-system}"
NS_ING="${NS_ING:-ingress-nginx}"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn(){ echo "⚠️ $*"; }
info(){ echo "ℹ️ $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

# Curl to LB IP using record.local for TLS (cert SAN). Returns 200 or 000 (exactly 3 chars).
_curl_lb() {
  local c="000"
  [[ -z "$lb_ip" ]] && echo "$c" && return
  c=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --resolve "record.local:443:$lb_ip" "https://record.local/_caddy/healthz" 2>/dev/null || echo "000")
  c="${c//$'\n'/}"
  echo "${c:0:3}"
}

# Reuse LB IP from env or detect
lb_ip="${LB_IP:-}"
[[ -z "$lb_ip" ]] && lb_ip=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
[[ -z "$lb_ip" ]] && lb_ip=$(kubectl get svc -A -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' 2>/dev/null | head -1 || echo "")

say "=== MetalLB advanced verification (BGP, route flaps, real L2/ARP, real asymmetric, hairpin, multi-subnet) ==="
if [[ "$ctx" == *"k3d"* ]]; then
  env_type="k3d (Docker)"
elif [[ "$ctx" == *"colima"* ]]; then
  env_type="Colima (real L2, real ARP, real asymmetric when 2+ nodes)"
else
  env_type="cluster (bare metal or other)"
fi
info "Context: $ctx — environment: $env_type"

# --- 1. BGP mode (vs L2) ---
if [[ "${SKIP_BGP:-0}" != "1" ]]; then
  say "1. BGP mode check (vs L2)"
  if _kb -n "$NS_METALLB" get bgppeer -o name 2>/dev/null | grep -q .; then
    _peers=$(_kb -n "$NS_METALLB" get bgppeer -o name 2>/dev/null | wc -l | tr -d ' ')
    ok "BGP mode: $_peers BGPPeer(s) configured"
    if _kb -n "$NS_METALLB" get bgpadvertisement -o name 2>/dev/null | grep -q .; then
      ok "BGPAdvertisement present — BGP path used for service IPs"
    else
      info "BGPAdvertisement not found; L2 may still be in use for some pools"
    fi
    _speaker_bgp=$(_kb -n "$NS_METALLB" get pods -l app=metallb,component=speaker -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$_speaker_bgp" ]]; then
      _bgp_logs=$(_kb -n "$NS_METALLB" logs "$_speaker_bgp" --tail=200 2>/dev/null || true)
      if echo "$_bgp_logs" | grep -qiE 'sessionUp|established|session.*up|state.*established|peer.*established|BGP_MSG_KEEPALIVE'; then
        ok "BGP session(s) established (speaker logs show session up)"
      elif echo "$_bgp_logs" | grep -qE 'connection refused|dial.*179'; then
        info "BGP configured; speaker cannot connect to peer (connection refused). Ensure FRR pod is Running and has capabilities NET_ADMIN,SYS_ADMIN (see infra/k8s/metallb/frr-deploy.yaml). Re-run after FRR is healthy. See docs/METALLB_ADVANCED.md"
      else
        info "BGP configured; no session-up seen in speaker logs (is BGP router reachable?). If FRR (or external BGP router) is running and BGPPeer is applied, ensure peerAddress is reachable from the speaker; re-run this script to verify BGP session. See docs/METALLB_ADVANCED.md"
      fi
    fi
  else
    info "L2 mode only (no BGPPeer). To enable BGP:"
    info " 1) Deploy a BGP router (e.g. FRR) reachable from cluster nodes."
    info " 2) Edit peerAddress/myASN/peerASN in infra/k8s/metallb/bgppeer.example.yaml then: kubectl apply -f infra/k8s/metallb/bgppeer.example.yaml"
    info " 3) kubectl apply -f infra/k8s/metallb/bgpadvertisement.example.yaml"
    info " 4) Re-run this script to verify BGP session. See docs/METALLB_ADVANCED.md"
  fi
else
  say "1. BGP mode check"
  info "Skipped (SKIP_BGP=1)"
fi

# --- 2. Route flap injection ---
if [[ "${SKIP_ROUTE_FLAPS:-0}" != "1" ]]; then
  say "2. Route flap / speaker restart (verify LB IP recovers)"
  if [[ -n "$lb_ip" ]]; then
    _before=$(_curl_lb)
    _speaker=$(_kb -n "$NS_METALLB" get pods -l app=metallb,component=speaker -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$_speaker" ]]; then
      info "Deleting one speaker pod to simulate route flap…"
      _kb -n "$NS_METALLB" delete pod "$_speaker" --ignore-not-found --timeout=5s 2>/dev/null || true
      info "Waiting for speaker pod to be fully removed (clean ARP withdrawal)..."
      _kb -n "$NS_METALLB" wait --for=delete "pod/$_speaker" --timeout=60s 2>/dev/null || true
      info "Waiting 15s for MetalLB to recover, then retrying curl (up to 5 attempts)..."
      sleep 15
      _after="000"
      for _i in 1 2 3 4 5; do
        _after=$(_curl_lb)
        [[ "$_after" == "200" ]] && break
        [[ $_i -lt 5 ]] && sleep 5
      done
      if [[ "$_after" == "200" ]]; then
        ok "LB IP $lb_ip reachable after speaker restart (route flap recovery OK)"
        # QUIC can still fail (ERR_HANDSHAKE_TIMEOUT) until ARP/BGP fully converge. With L2+BGP both on, wait 15-20s before manual curl --http3-only. See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md §5b.
        info "If manual curl --http3-only fails with ERR_HANDSHAKE_TIMEOUT, wait 15-20s for L2/BGP convergence or use L2-only (delete BGPAdvertisement) for stable QUIC on single-node."
      else
        warn "LB IP returned $_after after speaker restart (retry curl to $lb_ip in a few seconds)"
      fi
    else
      info "No speaker pod found; skipping route flap test"
    fi
  else
    info "No LB IP; skipping route flap test"
  fi
else
  say "2. Route flap"
  info "Skipped (SKIP_ROUTE_FLAPS=1)"
fi

# --- 3. Real L2 / ARP (Colima k3s = real ARP; k3d = sim) ---
if [[ "${SKIP_ARP_SIM:-0}" != "1" ]]; then
  if [[ "$ctx" == *"colima"* ]]; then
    say "3. Real L2 / ARP (Colima k3s — real ARP, no simulation)"
    info "Path: MetalLB speaker announces $lb_ip on the VM bridge (real L2). Host → $lb_ip via route (e.g. 192.168.5.0/24 via Colima node) or via 127.0.0.1 forward; in-VM traffic uses real ARP on the bridge."
  else
    say "3. ARP poisoning simulation (L2)"
  fi
  if _kb -n "$NS_METALLB" get l2advertisement -o name 2>/dev/null | grep -q .; then
    if [[ -z "$lb_ip" ]]; then
      info "No LB IP; skipping ARP sim"
    else
      _code_before=$(_curl_lb)
      [[ "$_code_before" == "200" ]] && ok "LB IP $lb_ip reachable (baseline)"
      _arp_done=""
      _iface=""
      if [[ -n "${ARP_TEST_INTERFACE:-}" ]]; then
        _iface="$ARP_TEST_INTERFACE"
      elif [[ "$(uname -s)" == "Linux" ]]; then
        _iface=$(ip route get "$lb_ip" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1 || true)
      elif [[ "$(uname -s)" == "Darwin" ]]; then
        _iface=$(route -n get "$lb_ip" 2>/dev/null | awk '/interface:/{print $2; exit}' || true)
      fi
      if [[ -n "$_iface" ]] && [[ "$_iface" != "lo0" ]] && [[ "$_iface" != "lo" ]] && command -v arping >/dev/null 2>&1; then
        if [[ "$ctx" == *"colima"* ]]; then
          info "Real L2: host on same L2 (interface $_iface). Sending GARP for $lb_ip to verify ARP path."
        else
          info "Real L2 ARP test: sending GARP for $lb_ip from host (interface $_iface)…"
        fi
        if arping -U -c 1 -I "$_iface" "$lb_ip" 2>/dev/null; then
          sleep 1
          _code_poison=$(_curl_lb)
          if [[ "$_code_poison" != "200" ]]; then
            ok "Real L2 ARP: after GARP, curl returned $_code_poison (traffic affected as expected)"
          else
            info "Real L2 ARP: after GARP, curl still 200 (ARP cache or path)"
          fi
          _arp_done=1
        fi
      fi
      if [[ -n "$_iface" ]] && { [[ "$_iface" == "lo0" ]] || [[ "$_iface" == "lo" ]]; }; then
        if [[ "$ctx" == *"colima"* ]]; then
          info "Path: host → $lb_ip via $_iface (route to Colima node). Real L2/ARP is in-VM only (bridge); host is not on the VM L2 segment."
        else
          info "Host route to $lb_ip is via $_iface (loopback) — real L2 ARP test skipped; host not on pod L2"
        fi
        [[ "$ctx" == *"colima"* ]] && _arp_done=1
      fi
      if [[ -z "$_arp_done" ]] && [[ -z "$_iface" ]] && command -v arping >/dev/null 2>&1 && arping -U -c 1 "$lb_ip" 2>/dev/null; then
        sleep 1
        _code_poison=$(_curl_lb)
        [[ "$_code_poison" != "200" ]] && ok "ARP sim: after GARP, curl returned $_code_poison" || info "ARP sim: after GARP, curl still 200"
        _arp_done=1
      fi
      if [[ -z "$_arp_done" ]]; then
        _arp_pod="arp-sim-$$"
        if _kb run "$_arp_pod" --image=alpine:3.18 --restart=Never --overrides='{"spec":{"containers":[{"name":"arp","image":"alpine:3.18","command":["sleep","60"],"securityContext":{"capabilities":{"add":["NET_RAW"]}}}]}}' 2>/dev/null; then
          _arp_ns="default"
          _waited=0
          while [[ $_waited -lt 15 ]] && ! _kb -n "$_arp_ns" get pod "$_arp_pod" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Running; do sleep 2; _waited=$((_waited + 2)); done
          # Always exit 0 so kubectl exec does not print "command terminated with exit code 1" (arping often fails when pod is not on same L2 as LB IP, e.g. Colima).
          if _kb -n "$_arp_ns" exec "$_arp_pod" -- sh -c "apk add --no-cache arping >/dev/null 2>&1; arping -U -c 3 -I eth0 $lb_ip >/dev/null 2>&1; exit 0" 2>/dev/null; then
            sleep 1
            _code_poison=$(_curl_lb)
            _code_poison="${_code_poison:0:3}"
            if [[ "$_code_poison" != "200" ]]; then
              ok "ARP sim (pod GARP): curl returned $_code_poison (traffic affected)"
            else
              [[ "$ctx" == *"colima"* ]] && info "In-cluster path: pod (eth0) → VM L2 bridge → $lb_ip (MetalLB speaker). Host curl uses route path."
              info "Pod GARP: curl still 200 — on $env_type the host path typically uses route/forward, so the host is not on the pod L2."
            fi
          else
            info "Pod GARP not run (install/arping failed); baseline curl above"
          fi
          _kb -n "$_arp_ns" delete pod "$_arp_pod" --ignore-not-found --force --grace-period=0 &>/dev/null || true
        else
          info "ARP sim: could not create arp-sim pod; baseline curl only"
        fi
      fi
      info "Waiting 10s for recovery, then retrying curl (up to 5 attempts)..."
      sleep 10
      _code_after="000"
      for _i in 1 2 3 4 5; do
        _code_after=$(_curl_lb)
        _code_after="${_code_after:0:3}"
        [[ "$_code_after" == "200" ]] && break
        [[ $_i -lt 5 ]] && sleep 3
      done
      if [[ "$_code_after" == "200" ]]; then
        ok "LB IP $lb_ip reachable after ARP check (recovery OK)"
      else
        warn "LB IP returned $_code_after after ARP check (retry curl to $lb_ip in a few seconds)"
      fi
    fi
  else
    info "No L2Advertisement; skipping ARP check"
  fi
else
  say "3. Real L2 / ARP"
  info "Skipped (SKIP_ARP_SIM=1)"
fi

# --- 4. Real asymmetric routing (Colima k3s = real asymmetric when 2+ nodes) ---
if [[ "${SKIP_ASYMMETRIC:-0}" != "1" ]]; then
  if [[ "$ctx" == *"colima"* ]]; then
    say "4. Real asymmetric routing (Colima k3s — two distinct node→LB paths when 2+ nodes)"
  else
    say "4. Asymmetric routing (dual-path — curl from two different nodes)"
  fi
  if [[ -z "$lb_ip" ]]; then
    info "No LB IP; skipping asymmetric test"
  else
    _nodes=($(_kb get nodes -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true))
    _ncount=${#_nodes[@]}
    if [[ "${_ncount:-0}" -lt 2 ]]; then
      _a=$(_curl_lb)
      sleep 1
      _b=$(_curl_lb)
      if [[ "$_a" == "200" ]] && [[ "$_b" == "200" ]]; then
        if [[ "$ctx" == *"colima"* ]]; then
          # Single-node Colima: also verify node path (hostNetwork pod) so we have "host path" and "node path" both 200.
          _node_path_ok=""
          _sn_pod="single-node-path-$$"
          _kb delete pod -n default "$_sn_pod" --ignore-not-found --force --grace-period=0 &>/dev/null || true
          sleep 1
          _sn_cmd="c=\$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 4 --max-time 8 -H 'Host: record.local' \"https://$lb_ip/_caddy/healthz\" 2>/dev/null); echo NODE_PATH_CODE:\${c:-000}"
          cat <<PODSN | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $_sn_pod
  namespace: default
  labels:
    app: single-node-path-verify
spec:
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command: ["/bin/sh", "-c", "$_sn_cmd"]
PODSN
          _sn_waited=0
          while [[ $_sn_waited -lt 25 ]]; do
            _sn_ph=$(_kb -n default get pod "$_sn_pod" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
            [[ "$_sn_ph" == "Succeeded" ]] || [[ "$_sn_ph" == "Failed" ]] && break
            sleep 2
            _sn_waited=$((_sn_waited + 2))
          done
          _node_code=$(_kb -n default logs "$_sn_pod" -c curl 2>/dev/null | sed -n 's/.*NODE_PATH_CODE:\([0-9]*\).*/\1/p' | tail -1)
          _kb -n default delete pod "$_sn_pod" --ignore-not-found --force --grace-period=0 &>/dev/null || true
          if [[ "${_node_code:-000}" == "200" ]]; then
            _node_path_ok=1
          fi
          info "Path: single node — host → $lb_ip (one path). Real asymmetric = two distinct node→LB paths; add a second node to test."
          if [[ -n "$_node_path_ok" ]]; then
            ok "Single-node Colima: host path and node (hostNetwork) path both 200; add second node for real asymmetric (two node→LB paths)"
          else
            ok "Dual requests to LB IP both 200 (single node; real asymmetric needs 2+ nodes)"
          fi
        else
          ok "Dual requests to LB IP both 200 (single node; full asymmetric needs 2+ nodes — set SKIP_ASYMMETRIC=1 to silence)"
        fi
      else
        warn "Asymmetric check: first=$_a second=$_b"
      fi
    else
      _ns_asym="default"
      _pod_a="asym-a-$$"
      _pod_b="asym-b-$$"
      _node_a="${_nodes[0]}"
      _node_b="${_nodes[1]}"
      if [[ "$ctx" == *"colima"* ]]; then
        info "Path A: node $_node_a (hostNetwork) → $lb_ip (MetalLB L2). Path B: node $_node_b (hostNetwork) → $lb_ip. Real asymmetric = two distinct node→LB paths."
      fi
      _kb delete pod -n "$_ns_asym" "$_pod_a" "$_pod_b" --ignore-not-found --timeout=5s 2>/dev/null || true
      sleep 1
      _curl_cmd="c=\$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 4 --max-time 8 -H 'Host: record.local' 'https://$lb_ip/_caddy/healthz' 2>/dev/null); echo ASYM_CODE:\${c:-000}"
      cat <<PODA | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $_pod_a
  namespace: $_ns_asym
  labels:
    app: asym-verify
spec:
  nodeName: $_node_a
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command: ["/bin/sh", "-c", "$_curl_cmd"]
PODA
      cat <<PODB | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $_pod_b
  namespace: $_ns_asym
  labels:
    app: asym-verify
spec:
  nodeName: $_node_b
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command: ["/bin/sh", "-c", "$_curl_cmd"]
PODB
      _waited=0
      while [[ $_waited -lt 30 ]]; do
        _pa=$(_kb -n "$_ns_asym" get pod "$_pod_a" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
        _pb=$(_kb -n "$_ns_asym" get pod "$_pod_b" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
        [[ "$_pa" == "Succeeded" ]] && [[ "$_pb" == "Succeeded" ]] && break
        [[ "$_pa" == "Failed" ]] && [[ "$_pb" == "Failed" ]] && break
        sleep 2
        _waited=$((_waited + 2))
      done
      _code_a=$(_kb -n "$_ns_asym" logs "$_pod_a" -c curl 2>/dev/null | sed -n 's/.*ASYM_CODE:\([0-9]*\).*/\1/p' | tail -1)
      _code_b=$(_kb -n "$_ns_asym" logs "$_pod_b" -c curl 2>/dev/null | sed -n 's/.*ASYM_CODE:\([0-9]*\).*/\1/p' | tail -1)
      _code_a="${_code_a:-000}"
      _code_b="${_code_b:-000}"
      _kb delete pod -n "$_ns_asym" "$_pod_a" "$_pod_b" --ignore-not-found --timeout=5s 2>/dev/null || true
      if [[ "$_code_a" == "200" ]] && [[ "$_code_b" == "200" ]]; then
        if [[ "$ctx" == *"colima"* ]]; then
          ok "Real asymmetric OK: LB IP $lb_ip reachable from node $_node_a (Path A: $_code_a) and $_node_b (Path B: $_code_b) — two distinct node→LB paths"
        else
          ok "Full asymmetric OK: LB IP $lb_ip reachable from node $_node_a ($_code_a) and $_node_b ($_code_b) (two distinct paths)"
        fi
      elif [[ "$ctx" == *"k3d"* ]] || [[ "$ctx" == *"colima"* ]]; then
        if [[ "$_code_a" == "000" ]] && [[ "$_code_b" == "000" ]]; then
          info "Real asymmetric paths (node→LB): $_node_a=$_code_a, $_node_b=$_code_b. On $env_type single-node or no node route to LB IP; host path (route/socat) is the verified path."
        else
          info "Real asymmetric: Path A $_node_a=$_code_a, Path B $_node_b=$_code_b — on $env_type host path is the verified path."
        fi
      else
        warn "Asymmetric: node $_node_a=$_code_a node $_node_b=$_code_b (both must be 200)"
      fi
    fi
  fi
else
  say "4. Asymmetric routing"
  info "Skipped (SKIP_ASYMMETRIC=1)"
fi

# --- 5. Hairpin (pod → LB IP) ---
if [[ "${SKIP_HAIRPIN:-0}" != "1" ]]; then
  say "5. Hairpin (pod → LB IP, real L2)"
  if [[ -z "$lb_ip" ]]; then
    info "No LB IP; skipping hairpin test"
  else
    _ns_hp="default"
    _pod_hp="hairpin-$$"
    _kb delete pod -n "$_ns_hp" "$_pod_hp" --ignore-not-found --force --grace-period=0 &>/dev/null || true
    sleep 1
    # hostNetwork so pod uses node's network stack and can reach LB IP on L2/bridge (Colima, bare metal).
    # Without it, pod network (10.42.x) often has no route to MetalLB pool (192.168.5.x).
    _curl_hp="c=\$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 12 -H 'Host: record.local' \"https://$lb_ip/_caddy/healthz\" 2>/dev/null); echo HAIRPIN_CODE:\${c:-000}"
    cat <<PODHP | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $_pod_hp
  namespace: $_ns_hp
  labels:
    app: hairpin-verify
spec:
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command: ["/bin/sh", "-c", "$_curl_hp"]
PODHP
    _waited=0
    while [[ $_waited -lt 45 ]]; do
      _ph=$(_kb -n "$_ns_hp" get pod "$_pod_hp" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
      [[ "$_ph" == "Succeeded" ]] || [[ "$_ph" == "Failed" ]] && break
      sleep 2
      _waited=$((_waited + 2))
    done
    _code_hp=$(_kb -n "$_ns_hp" logs "$_pod_hp" -c curl 2>/dev/null | sed -n 's/.*HAIRPIN_CODE:\([0-9]*\).*/\1/p' | tail -1)
    _code_hp="${_code_hp:-000}"
    # On Colima, one retry in case node/route was not ready
    if [[ "$_code_hp" != "200" ]] && [[ "$ctx" == *"colima"* ]] && [[ "${HAIRPIN_RETRY:-1}" == "1" ]]; then
      _kb delete pod -n "$_ns_hp" "$_pod_hp" --ignore-not-found --force --grace-period=0 &>/dev/null || true
      sleep 5
      _pod_hp="hairpin-retry-$$"
      _kb delete pod -n "$_ns_hp" "$_pod_hp" --ignore-not-found --force --grace-period=0 &>/dev/null || true
      sleep 1
      cat <<PODHP2 | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $_pod_hp
  namespace: $_ns_hp
  labels:
    app: hairpin-verify
spec:
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command: ["/bin/sh", "-c", "$_curl_hp"]
PODHP2
      _waited=0
      while [[ $_waited -lt 45 ]]; do
        _ph=$(_kb -n "$_ns_hp" get pod "$_pod_hp" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
        [[ "$_ph" == "Succeeded" ]] || [[ "$_ph" == "Failed" ]] && break
        sleep 2
        _waited=$((_waited + 2))
      done
      _code_hp=$(_kb -n "$_ns_hp" logs "$_pod_hp" -c curl 2>/dev/null | sed -n 's/.*HAIRPIN_CODE:\([0-9]*\).*/\1/p' | tail -1)
      _code_hp="${_code_hp:-000}"
    fi
    _kb delete pod -n "$_ns_hp" "$_pod_hp" --ignore-not-found --force --grace-period=0 &>/dev/null || true
    if [[ "$_code_hp" == "200" ]]; then
      ok "Hairpin OK: pod → LB IP $lb_ip → 200 (real L2 path)"
    elif [[ "$ctx" == *"k3d"* ]] || [[ "$ctx" == *"colima"* ]]; then
      info "Hairpin: pod returned $_code_hp (on $env_type nodes may have no route to LB IP or rp_filter blocks hairpin; host path is verified). For real hairpin ensure node has route to $lb_ip (same L2 as MetalLB)."
    else
      warn "Hairpin: pod → LB IP returned $_code_hp (expected 200)"
    fi
  fi
else
  say "5. Hairpin"
  info "Skipped (SKIP_HAIRPIN=1)"
fi

# --- 6. Multi-subnet / multi-pool ---
if [[ "${SKIP_MULTI_SUBNET:-0}" != "1" ]]; then
  say "6. Multi-subnet / multi-pool (real test: second pool + temp LoadBalancer)"
  _pools=$(_kb -n "$NS_METALLB" get ipaddresspool -o name 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  _pool_names=()
  while IFS= read -r p; do
    [[ -n "$p" ]] && _pool_names+=("${p##*/}")
  done < <(_kb -n "$NS_METALLB" get ipaddresspool -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n')
  _created_pool2=""
  _created_l2_2=""
  _pool2_ip=""
  _cleanup_multi() {
    [[ -n "$_created_l2_2" ]] && _kb -n "$NS_METALLB" delete l2advertisement "$_created_l2_2" --ignore-not-found --timeout=5s 2>/dev/null || true
    [[ -n "$_created_pool2" ]] && _kb -n "$NS_METALLB" delete ipaddresspool "$_created_pool2" --ignore-not-found --timeout=5s 2>/dev/null || true
    _kb -n default delete svc multi-subnet-echo-$$ --ignore-not-found --timeout=5s 2>/dev/null || true
    _kb -n default delete deploy multi-subnet-echo-$$ --ignore-not-found --timeout=5s 2>/dev/null || true
  }
  trap _cleanup_multi EXIT
  if [[ "${_pools:-0}" -ge 2 ]]; then
    _pool2_name="${_pool_names[1]}"
    info "Using existing second pool: $_pool2_name"
  else
    _main_range=$(_kb -n "$NS_METALLB" get ipaddresspool record-platform-pool -o jsonpath='{.spec.addresses[0]}' 2>/dev/null || echo "192.168.106.240-192.168.106.250")
    # Parse range (a-b) or single/CIDR (x/y); ensure we get a valid last IP for _pool2_ip
    _last_ip=""
    if [[ "$_main_range" == *-* ]]; then
      _last_ip=$(echo "$_main_range" | sed -n 's/.*-\([0-9][0-9.]*\).*/\1/p')
    else
      _last_ip=$(echo "$_main_range" | sed -nE 's/^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+).*/\1/p')
    fi
    _base=$(echo "$_last_ip" | sed -nE 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+$/\1/p')
    _last_octet=$(echo "$_last_ip" | sed -nE 's/^[0-9]+\.[0-9]+\.[0-9]+\.([0-9]+)$/\1/p')
    _next_octet=251
    [[ -n "$_last_octet" ]] && [[ "$_last_octet" =~ ^[0-9]+$ ]] && _next_octet=$((_last_octet + 1))
    [[ "${_next_octet:-251}" -gt 254 ]] && _next_octet=249
    [[ -n "$_base" ]] && [[ "$_base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && _pool2_ip="$_base.$_next_octet"
    # If parsing failed, derive from lb_ip or use safe default so pool has valid /32
    if [[ -z "$_pool2_ip" ]] || [[ "$_pool2_ip" != *.*.*.* ]]; then
      _pool2_ip=""
      if [[ -n "$lb_ip" ]] && [[ "$lb_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.([0-9]+)$ ]]; then
        _lo="${BASH_REMATCH[1]}"
        _bo=$(echo "$lb_ip" | sed -nE 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+$/\1/p')
        [[ -n "$_bo" ]] && _next=$((_lo + 11)) && [[ $_next -le 254 ]] && _pool2_ip="$_bo.$_next"
      fi
      [[ -z "$_pool2_ip" ]] && _pool2_ip="192.168.5.251"
    fi
    _pool2_name="record-platform-pool2-$$"
    _created_pool2="$_pool2_name"
    cat <<POOL2 | _kb apply -f - 2>/dev/null || true
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: $_pool2_name
  namespace: $NS_METALLB
spec:
  addresses:
  - ${_pool2_ip}/32
POOL2
    _l2_name="record-platform-l2-pool2-$$"
    _created_l2_2="$_l2_name"
    cat <<L22 | _kb apply -f - 2>/dev/null || true
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: $_l2_name
  namespace: $NS_METALLB
spec:
  ipAddressPools:
  - $_pool2_name
L22
    info "Created temporary second pool $_pool2_name ($_pool2_ip) and L2Advertisement for multi-pool test"
    info "Waiting 8s for MetalLB controller to reconcile new pool…"
    sleep 8
  fi
  _requested_ip=""
  [[ -n "$_created_pool2" ]] && [[ -n "${_pool2_ip:-}" ]] && _requested_ip="$_pool2_ip"
  _deploy_name="multi-subnet-echo-$$"
  _kb -n default delete deploy "$_deploy_name" --ignore-not-found 2>/dev/null || true
  _kb -n default delete svc "$_deploy_name" --ignore-not-found 2>/dev/null || true
  sleep 1
  cat <<DEPLOY | _kb apply -f - 2>/dev/null || true
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $_deploy_name
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: multi-subnet-echo
  template:
    metadata:
      labels:
        app: multi-subnet-echo
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
        ports:
        - containerPort: 80
DEPLOY
  if [[ -n "$_requested_ip" ]]; then
    cat <<SVC | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Service
metadata:
  name: $_deploy_name
  namespace: default
  annotations:
    metallb.io/address-pool: "$_pool2_name"
spec:
  type: LoadBalancer
  loadBalancerIP: "$_requested_ip"
  selector:
    app: multi-subnet-echo
  ports:
  - port: 80
    targetPort: 80
SVC
  else
    cat <<SVC | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Service
metadata:
  name: $_deploy_name
  namespace: default
  annotations:
    metallb.io/address-pool: "$_pool2_name"
spec:
  type: LoadBalancer
  selector:
    app: multi-subnet-echo
  ports:
  - port: 80
    targetPort: 80
SVC
  fi
  _wait_ready=0
  while [[ $_wait_ready -lt 30 ]]; do
    _ready=$(_kb -n default get deploy "$_deploy_name" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    [[ "${_ready:-0}" -ge 1 ]] && break
    sleep 2
    _wait_ready=$((_wait_ready + 2))
  done
  _wait=0
  _ext_ip=""
  while [[ $_wait -lt 90 ]]; do
    _ext_ip=$(_kb -n default get svc "$_deploy_name" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    [[ -n "$_ext_ip" ]] && break
    sleep 3
    _wait=$((_wait + 3))
  done
  if [[ -n "$_ext_ip" ]]; then
    if [[ -n "$_created_pool2" ]] && [[ -n "${_pool2_ip:-}" ]] && [[ "$_ext_ip" != "$_pool2_ip" ]]; then
      warn "Multi-pool: expected IP $_pool2_ip from pool2 but got $_ext_ip"
    fi
    _code_multi="000"
    if [[ "$ctx" == *"k3d"* ]]; then
      _curl_pod="multi-curl-$$"
      _kb delete pod "$_curl_pod" --ignore-not-found 2>/dev/null || true
      sleep 1
      _kb run "$_curl_pod" --restart=Never --image=curlimages/curl:latest --overrides="{\"spec\":{\"hostNetwork\":true,\"containers\":[{\"name\":\"c\",\"image\":\"curlimages/curl:latest\",\"command\":[\"sh\",\"-c\",\"curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 4 --max-time 8 http://$_ext_ip/ 2>/dev/null || echo 000\"]}]}}" 2>/dev/null || true
      _w=0
      while [[ $_w -lt 25 ]]; do
        _ph=$(_kb get pod "$_curl_pod" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
        [[ "$_ph" == "Succeeded" ]] && _code_multi=$(_kb logs "$_curl_pod" --tail=3 2>/dev/null | tr -d '\r' | grep -oE '[0-9]{3}' | head -1) && break
        [[ "$_ph" == "Failed" ]] && break
        sleep 2
        _w=$((_w + 2))
      done
      _code_multi=${_code_multi:-000}
      _code_multi="${_code_multi:0:3}"
      _kb delete pod "$_curl_pod" --ignore-not-found --timeout=5s 2>/dev/null || true
    fi
    if [[ "$_code_multi" != "200" ]]; then
      for _t in 1 2 3 4 5; do
        _code_multi=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 "http://$_ext_ip/" 2>/dev/null || echo "000")
        _code_multi="${_code_multi:-000}"
        _code_multi="${_code_multi:0:3}"
        [[ "$_code_multi" == "200" ]] && break
        sleep 2
      done
    fi
    _code_multi="${_code_multi:0:3}"
    if [[ "$_code_multi" == "200" ]]; then
      ok "Multi-pool OK: temp LoadBalancer in pool $_pool2_name got IP $_ext_ip and returned HTTP 200"
    elif [[ "$ctx" == *"k3d"* ]] && [[ -n "$_created_pool2" ]] && [[ "$_ext_ip" == "$_pool2_ip" ]]; then
      ok "Multi-pool: pool assignment OK — temp LoadBalancer got IP $_ext_ip from pool $_pool2_name. Curl to second IP returned $_code_multi (on k3d host/pod often have no route to second LB IP; pool test passed)."
    else
      warn "Multi-pool: temp service got $_ext_ip but curl returned ${_code_multi:-000} (in-cluster and host tried)"
    fi
  else
    warn "Multi-pool: temp LoadBalancer did not get an external IP within 90s"
    info "Diagnostics: service events below."
    _kb -n default describe svc "$_deploy_name" 2>/dev/null | sed -n '1,/^Events:/p;/^Events:/,/^[^ ]/p' | tail -30
    _ctrl=$(_kb -n "$NS_METALLB" get pods -l app=metallb,component=controller -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$_ctrl" ]]; then
      info "MetalLB controller logs (last 15 lines):"
      _kb -n "$NS_METALLB" logs "$_ctrl" --tail=15 2>/dev/null | sed 's/^/ /'
    fi
  fi
  _cleanup_multi
  trap - EXIT
else
  say "6. Multi-subnet failover"
  info "Skipped (SKIP_MULTI_SUBNET=1)"
fi

say "=== MetalLB advanced verification complete ==="
