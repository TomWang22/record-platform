#!/usr/bin/env bash
# Regression: verify that verify-bootstrap-state and verify-http3-and-runtime enforce MetalLB-only
# contract — no nodePort assertions, allocateLoadBalancerNodePorts=false is required, etc.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok()  { echo "✅ $*"; }

echo "=== Structural checks ==="

VBS="$REPO_ROOT/scripts/verify-bootstrap-state.mjs"
VH3="$REPO_ROOT/scripts/verify-http3-and-runtime.mjs"

grep -q 'EDGE_LB_MODE' "$VBS" \
  && ok "verify-bootstrap-state.mjs references EDGE_LB_MODE" \
  || bad "verify-bootstrap-state.mjs missing EDGE_LB_MODE"

grep -q 'metallb-only' "$VBS" \
  && ok "verify-bootstrap-state.mjs has metallb-only mode" \
  || bad "verify-bootstrap-state.mjs missing metallb-only mode"

grep -q 'allocateLoadBalancerNodePorts' "$VBS" \
  && ok "verify-bootstrap-state.mjs checks allocateLoadBalancerNodePorts" \
  || bad "verify-bootstrap-state.mjs missing allocateLoadBalancerNodePorts check"

grep -q 'EDGE_LB_MODE' "$VH3" \
  && ok "verify-http3-and-runtime.mjs references EDGE_LB_MODE" \
  || bad "verify-http3-and-runtime.mjs missing EDGE_LB_MODE"

grep -q 'metallb-only' "$VH3" \
  && ok "verify-http3-and-runtime.mjs has metallb-only mode" \
  || bad "verify-http3-and-runtime.mjs missing metallb-only mode"

echo ""
echo "=== Anti-pattern checks ==="

if grep -q '"set nodePort on https-udp"' "$VBS" 2>/dev/null; then
  bad "verify-bootstrap-state.mjs still suggests setting nodePort"
else
  ok "verify-bootstrap-state.mjs does not suggest setting nodePort"
fi

if grep -q 'k3s/LoadBalancer often omits it unless set' "$VBS" 2>/dev/null; then
  bad "verify-bootstrap-state.mjs still has stale k3s nodePort omission message"
else
  ok "verify-bootstrap-state.mjs has no stale k3s omission message"
fi

if grep -qE 'checkUdpNodePort' "$VH3" 2>/dev/null; then
  bad "verify-http3-and-runtime.mjs still has checkUdpNodePort function"
else
  ok "verify-http3-and-runtime.mjs uses checkUdpPort (mode-aware)"
fi

echo ""
echo "=== MetalLB-only invariant checks ==="

if grep -q 'svclb-caddy-h3' "$VBS" 2>/dev/null; then
  ok "verify-bootstrap-state.mjs checks for absence of svclb-caddy-h3"
else
  bad "verify-bootstrap-state.mjs does not check for svclb-caddy-h3 absence"
fi

if grep -q 'metallb-system.*controller' "$VBS" 2>/dev/null; then
  ok "verify-bootstrap-state.mjs checks MetalLB controller readiness"
else
  bad "verify-bootstrap-state.mjs does not check MetalLB controller readiness"
fi

if grep -q 'nodePorts.*anti-pattern\|nodePort.*anti-pattern' "$VBS" 2>/dev/null; then
  ok "verify-bootstrap-state.mjs flags nodePort as anti-pattern in metallb-only mode"
else
  bad "verify-bootstrap-state.mjs does not flag nodePort as anti-pattern"
fi

echo ""
echo "=== Report path consistency ==="

if grep -q 'bench_logs/edge-http3-strict' "$REPO_ROOT/scripts/rp-cold-run-prep.sh" 2>/dev/null; then
  bad "rp-cold-run-prep.sh still has stale bench_logs/edge-http3-strict path"
else
  ok "rp-cold-run-prep.sh uses correct bench_logs/edge-h3-strict path"
fi

echo ""
echo "=== Contract readability guard ==="
if grep -q '\[\[ -r "\$CONTRACT" \]\]' "$REPO_ROOT/scripts/smoke-rp-edge-contract.sh" 2>/dev/null; then
  ok "smoke-rp-edge-contract.sh has contract readability guard"
else
  bad "smoke-rp-edge-contract.sh missing contract readability guard"
fi

echo ""
echo "=== Live cluster check (if available) ==="
if ! kubectl cluster-info --request-timeout=5s >/dev/null 2>&1; then
  echo "ℹ️  cluster not up — skipping live checks"
else
  SVC_JSON="$(kubectl -n ingress-nginx get svc caddy-h3 -o json --request-timeout=15s 2>/dev/null || true)"
  if [[ -z "$SVC_JSON" ]]; then
    echo "ℹ️  caddy-h3 service not found — skip"
  else
    alloc="$(echo "$SVC_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("spec",{}).get("allocateLoadBalancerNodePorts","<unset>"))' 2>/dev/null || true)"
    [[ "$alloc" == "False" ]] && ok "allocateLoadBalancerNodePorts=false" \
      || bad "allocateLoadBalancerNodePorts=$alloc (expected False)"

    np_count="$(echo "$SVC_JSON" | python3 -c 'import json,sys; ports=json.load(sys.stdin).get("spec",{}).get("ports",[]); print(sum(1 for p in ports if p.get("nodePort")))' 2>/dev/null || true)"
    [[ "$np_count" == "0" ]] && ok "no nodePorts on caddy-h3 (correct for metallb-only)" \
      || bad "caddy-h3 has $np_count nodePort(s) — should be 0 in metallb-only mode"

    lb_ip="$(echo "$SVC_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",{}).get("loadBalancer",{}).get("ingress",[{}])[0].get("ip",""))' 2>/dev/null || true)"
    [[ -n "$lb_ip" ]] && ok "LoadBalancer IP=$lb_ip" \
      || bad "no LoadBalancer IP assigned"

    tcp443="$(echo "$SVC_JSON" | python3 -c 'import json,sys; ports=json.load(sys.stdin).get("spec",{}).get("ports",[]); print("yes" if any(p.get("protocol")=="TCP" and p.get("port")==443 for p in ports) else "no")' 2>/dev/null || true)"
    udp443="$(echo "$SVC_JSON" | python3 -c 'import json,sys; ports=json.load(sys.stdin).get("spec",{}).get("ports",[]); print("yes" if any(p.get("protocol")=="UDP" and p.get("port")==443 for p in ports) else "no")' 2>/dev/null || true)"
    [[ "$tcp443" == "yes" ]] && ok "TCP 443 present" || bad "TCP 443 missing"
    [[ "$udp443" == "yes" ]] && ok "UDP 443 present" || bad "UDP 443 missing"

    svclb="$(kubectl -n kube-system get daemonset svclb-caddy-h3 --no-headers 2>/dev/null || true)"
    [[ -z "$svclb" ]] && ok "no kube-system/svclb-caddy-h3 (correct: ServiceLB disabled)" \
      || bad "kube-system/svclb-caddy-h3 exists — ServiceLB should be disabled"
  fi
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ test-rp-metallb-only-no-nodeport-verifier passed"
  exit 0
fi
echo "❌ test-rp-metallb-only-no-nodeport-verifier failed" >&2
exit 1
