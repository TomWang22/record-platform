#!/usr/bin/env bash
# Hard gate: caddy-h3 edge is MetalLB-only — no k3s ServiceLB / svclb / nodePorts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"
# shellcheck source=scripts/lib/rp-colima-k3s-start-args.sh
source "$SCRIPT_DIR/lib/rp-colima-k3s-start-args.sh"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

echo "audit-rp-metallb-only-edge"

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

if ! rp_http3_metallb_active; then
  bad "MetalLB speaker/controller not running in metallb-system"
else
  ok "MetalLB speaker/controller active"
fi

_svclb_hits="$(kubectl get ds,pods -n kube-system 2>/dev/null | grep -E 'svclb|servicelb|klipper' || true)"
if [[ -n "$_svclb_hits" ]]; then
  if echo "$_svclb_hits" | grep -qE 'svclb.*caddy-h3|svclb-caddy-h3'; then
    bad "k3s ServiceLB svclb-caddy-h3 present; edge is not MetalLB-only"
  else
    bad "k3s ServiceLB components present in kube-system (MetalLB-only contract violated)"
  fi
  echo "$_svclb_hits" >&2
else
  ok "no k3s ServiceLB / svclb edge path"
fi

if ! kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" >/dev/null 2>&1; then
  bad "Service ${RP_HTTP3_EDGE_SVC} not found in ${RP_HTTP3_EDGE_NS}"
else
  ALLOC="$(rp_http3_allocate_lb_nodeports 2>/dev/null || true)"
  [[ "$ALLOC" == "false" ]] && ok "allocateLoadBalancerNodePorts=false" \
    || bad "allocateLoadBalancerNodePorts must be false (got ${ALLOC:-unset})"

  if rp_http3_any_nodeport_set; then
    bad "caddy-h3 has non-empty nodePorts (MetalLB-only contract)"
  else
    ok "no nodePorts"
  fi

  ETP="$(rp_http3_external_traffic_policy 2>/dev/null || true)"
  [[ "$ETP" == "Local" ]] && ok "externalTrafficPolicy=Local" \
    || bad "externalTrafficPolicy must be Local (got ${ETP:-Cluster})"

  SA="$(rp_http3_session_affinity 2>/dev/null || true)"
  if [[ -n "${SA:-}" && "$SA" != "None" ]]; then
    bad "sessionAffinity must be None (got ${SA})"
  fi

  _has_tcp443=0 _has_udp443=0
  while IFS=$'\t' read -r name port proto; do
    [[ "$port" == "443" && "$proto" == "TCP" ]] && _has_tcp443=1
    [[ "$port" == "443" && "$proto" == "UDP" ]] && _has_udp443=1
  done < <(kubectl get svc "$RP_HTTP3_EDGE_SVC" -n "$RP_HTTP3_EDGE_NS" \
    -o jsonpath='{range .spec.ports[*]}{.name}{"\t"}{.port}{"\t"}{.protocol}{"\n"}{end}' 2>/dev/null)
  [[ "$_has_tcp443" -eq 1 ]] && ok "caddy-h3 exposes TCP 443" || bad "caddy-h3 missing TCP 443"
  [[ "$_has_udp443" -eq 1 ]] && ok "caddy-h3 exposes UDP 443" || bad "caddy-h3 missing UDP 443"
fi

LB="$(rp_http3_lb_ip || true)"
if [[ -n "$LB" && "$LB" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  ok "LB IP: ${LB}"
else
  bad "caddy-h3 has no .status.loadBalancer.ingress[0].ip"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "" >&2
  echo "Fix: cold-bootstrap P0/Z with colima --k3s-arg '--disable=servicelb,traefik' (no @server:N), then recreate caddy-h3 Service:" >&2
  echo "  kubectl -n ingress-nginx delete svc caddy-h3 --wait=true" >&2
  echo "  kubectl apply -f infra/k8s/loadbalancer.yaml" >&2
  exit 1
fi

echo "✅ MetalLB-only edge verified"
exit 0
