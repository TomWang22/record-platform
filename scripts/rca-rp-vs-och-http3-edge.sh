#!/usr/bin/env bash
# Compare RP edge topology for MetalLB EXTERNAL-IP-only design (no user-facing NodePort).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-http3-edge-lib.sh
source "$SCRIPT_DIR/lib/rp-http3-edge-lib.sh"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$REPO_ROOT/bench_logs/http3-edge-rca/$TS"
mkdir -p "$OUT_DIR"

run_capture() {
  local name="$1"
  shift
  { echo "\$ $*"; "$@" 2>&1 || true; } >"$OUT_DIR/${name}.txt"
}

say() { printf '%s\n' "$*" | tee -a "$OUT_DIR/report.md"; }

: >"$OUT_DIR/report.md"
say "# HTTP/3 edge RCA — MetalLB EXTERNAL-IP only"
say ""
say "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""

run_capture "svc-caddy-h3-yaml" kubectl -n "$RP_HTTP3_EDGE_NS" get svc "$RP_HTTP3_EDGE_SVC" -o yaml
run_capture "svc-caddy-h3-describe" kubectl -n "$RP_HTTP3_EDGE_NS" describe svc "$RP_HTTP3_EDGE_SVC"
run_capture "endpointslice-caddy-h3" kubectl -n "$RP_HTTP3_EDGE_NS" get endpointslice -l "kubernetes.io/service-name=$RP_HTTP3_EDGE_SVC" -o yaml
run_capture "metallb-controller-logs" kubectl -n metallb-system logs deploy/controller --tail=100
run_capture "metallb-speaker-logs" kubectl -n metallb-system logs ds/speaker --tail=100
run_capture "kube-proxy" kubectl get ds -n kube-system kube-proxy -o yaml
run_capture "metallb-pods" kubectl get pods -n metallb-system -o wide
run_capture "svclb-pods" bash -c "kubectl get pods -n kube-system | grep -E 'svclb|klipper|servicelb' || true"
run_capture "svclb-ds" bash -c "kubectl get ds -n kube-system | grep -E 'svclb|klipper|servicelb' || true"
run_capture "caddy-logs" kubectl -n "$RP_HTTP3_EDGE_NS" logs deploy/caddy-h3 --tail=200

LB_IP="$(rp_http3_lb_ip || true)"
ALLOC="$(rp_http3_allocate_lb_nodeports || true)"
ETP="$(rp_http3_external_traffic_policy || true)"
METALLB_ON=0
SVCLB_ON=0
rp_http3_metallb_active && METALLB_ON=1
rp_http3_svclb_active && SVCLB_ON=1
NP_SET=0
rp_http3_any_nodeport_set && NP_SET=1

say "## Target design"
say ""
say "Mac/browser/curl → MetalLB EXTERNAL-IP :443 TCP/UDP → Service caddy-h3 (LoadBalancer) → Caddy pods."
say "**No user-facing NodePort.** \`allocateLoadBalancerNodePorts: false\`."
say ""

say "## Live Service facts"
say ""
say "| Field | Value |"
say "|-------|-------|"
say "| EXTERNAL-IP | ${LB_IP:-pending} |"
say "| allocateLoadBalancerNodePorts | ${ALLOC:-unset} |"
say "| externalTrafficPolicy | ${ETP:-Cluster} |"
say "| nodePorts non-empty | $([[ $NP_SET -eq 1 ]] && echo YES || echo NO) |"
say ""
if [[ "$NP_SET" -eq 1 ]]; then
  say "**FAIL:** nodePorts are allocated — k3s ServiceLB/klipper may still be in path."
  kubectl -n "$RP_HTTP3_EDGE_NS" get svc "$RP_HTTP3_EDGE_SVC" \
    -o jsonpath='{range .spec.ports[*]}{.name} {.protocol} nodePort={.nodePort}{"\n"}{end}' 2>/dev/null \
    | while read -r line; do say "- $line"; done
else
  say "**OK:** all nodePort values empty."
fi
say ""

say "## Load balancer stack"
say ""
if [[ "$METALLB_ON" -eq 1 ]]; then
  say "- **MetalLB:** active (controller + speaker). LB IP from pool \`record-platform-pool\`."
else
  say "- **MetalLB:** not detected"
fi
if [[ "$SVCLB_ON" -eq 1 ]]; then
  say "- **k3s ServiceLB (svclb-caddy-h3):** **present** — klipper-lb DaemonSet binds nodePorts even when MetalLB assigns EXTERNAL-IP."
  say "  This can fight MetalLB semantics. Fix: k3s \`--disable servicelb\` + recreate Service with \`allocateLoadBalancerNodePorts: false\`."
else
  say "- **k3s ServiceLB:** no svclb-caddy-h3 (MetalLB-only path clean)."
fi
say ""

say "## OCH comparison (historical)"
say ""
say "OCH used explicit nodePorts 30443/30444 because k3s ServiceLB was in play."
say "RP target is **not** NodePort edge — MetalLB IP only. OCH nodePort discipline is an RCA reference only."
say ""

say "## Artifacts"
say ""
for f in "$OUT_DIR"/*.txt; do say "- \`$(basename "$f")\`"; done
say ""
say "Report: \`bench_logs/http3-edge-rca/$TS/report.md\`"

if [[ "$NP_SET" -eq 1 ]]; then
  echo "❌ RCA: caddy-h3 has allocated nodePorts (MetalLB-only contract violated)" >&2
  exit 1
fi
if [[ "$ALLOC" != "false" ]]; then
  echo "❌ RCA: allocateLoadBalancerNodePorts is not false" >&2
  exit 1
fi

echo "✅ RCA report: $OUT_DIR/report.md"
