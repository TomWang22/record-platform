#!/usr/bin/env bash
# MetalLB-only edge contract: no user-facing NodePorts on caddy-h3 LoadBalancer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"

FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

echo "audit-rp-metallb-quic-edge (manifest + live MetalLB-only gate)"

for mf in "$REPO_ROOT/infra/k8s/loadbalancer.yaml" "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml"; do
  [[ -f "$mf" ]] || { bad "missing manifest $mf"; continue; }
  grep -q 'allocateLoadBalancerNodePorts: false' "$mf" \
    && ok "$(basename "$mf") allocateLoadBalancerNodePorts: false" \
    || bad "$(basename "$mf") missing allocateLoadBalancerNodePorts: false"
  grep -q 'externalTrafficPolicy: Local' "$mf" \
    && ok "$(basename "$mf") externalTrafficPolicy: Local" \
    || bad "$(basename "$mf") missing externalTrafficPolicy: Local"
  if grep -qE 'nodePort:[[:space:]]*[0-9]+' "$mf"; then
    bad "$(basename "$mf") must not declare nodePort (MetalLB-only edge)"
  else
    ok "$(basename "$mf") has no nodePort fields"
  fi
done

for scan in "$REPO_ROOT/infra/k8s/loadbalancer.yaml" \
  "$REPO_ROOT/infra/k8s/caddy-h3-service-loadbalancer.yaml"; do
  [[ -f "$scan" ]] || continue
  if grep -qE '30443|30444' "$scan" 2>/dev/null; then
    bad "$(basename "$scan") references 30443/30444 (forbidden on MetalLB-only edge)"
  fi
done
ok "no 30443/30444 in MetalLB LoadBalancer manifests"

[[ "$FAIL" -eq 0 ]] || exit 1

bash "$SCRIPT_DIR/audit-rp-metallb-only-edge.sh"
