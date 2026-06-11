#!/usr/bin/env bash
# Emit release deploy package: SHA, image digests, K8s state, edge/Ollama LB, /etc/hosts line.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"
# shellcheck source=scripts/lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

NS="${RP_K8S_NS:-record-platform}"
INGRESS_NS="${RP_INGRESS_NS:-ingress-nginx}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/bench_logs/release-contract}"
REPORT="${REPORT:-$REPORT_DIR/rp-release-package.json}"
CONTRACT="${CONTRACT:-$REPORT_DIR/t14-deploy-package-contract.md}"
HOST="${RP_EDGE_HOSTNAME:-record-platform.test}"

mkdir -p "$REPORT_DIR"

RELEASE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
RELEASE_SHA_SHORT="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"

caddy_ip="$(kubectl -n "$INGRESS_NS" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
ollama_lb_ip=""
ollama_lb_type=""
if kubectl -n "$NS" get svc ollama-lb >/dev/null 2>&1; then
  ollama_lb_type="$(kubectl -n "$NS" get svc ollama-lb -o jsonpath='{.spec.type}' 2>/dev/null || true)"
  ollama_lb_ip="$(kubectl -n "$NS" get svc ollama-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
fi

metallb_mode="unknown"
if [[ -n "$caddy_ip" ]]; then
  metallb_mode="LoadBalancer"
elif kubectl -n "$INGRESS_NS" get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null | grep -q NodePort; then
  metallb_mode="NodePort"
fi

hosts_line=""
[[ -n "$caddy_ip" ]] && hosts_line="${caddy_ip} ${HOST}"

images_json="["
first=1
for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
  img="${svc}:dev"
  digest="missing"
  source_sha="missing"
  if docker image inspect "$img" >/dev/null 2>&1; then
    digest="$(docker image inspect "$img" --format '{{.Id}}' 2>/dev/null || echo missing)"
    source_sha="$(docker image inspect "$img" --format '{{index .Config.Labels "rp.dev.source-sha"}}' 2>/dev/null || echo missing)"
  fi
  deploy_image="$(kubectl -n "$NS" get deployment "$svc" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo n/a)"
  pod_name="$(kubectl -n "$NS" get pods -l "app=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo n/a)"
  pod_image_id="$(kubectl -n "$NS" get pod "$pod_name" -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null || echo n/a)"
  [[ "$first" -eq 1 ]] || images_json+=","
  first=0
  images_json+=$(cat <<EOF

  {"service":"$svc","local_image":"$img","docker_id":"$digest","rp_dev_source_sha":"$source_sha","deployment_image":"$deploy_image","pod":"$pod_name","pod_image_id":"$pod_image_id"}
EOF
)
done
images_json+="
]"

cat >"$REPORT" <<EOF
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "release_sha": "$RELEASE_SHA",
  "release_sha_short": "$RELEASE_SHA_SHORT",
  "namespace": "$NS",
  "edge_hostname": "$HOST",
  "caddy_lb_ip": "$caddy_ip",
  "ollama_lb_ip": "$ollama_lb_ip",
  "ollama_lb_type": "$ollama_lb_type",
  "metallb_mode": "$metallb_mode",
  "etc_hosts_line": "$hosts_line",
  "images": $images_json
}
EOF

echo "rp-release-package: $REPORT"
echo "  release_sha=$RELEASE_SHA_SHORT"
echo "  caddy_lb_ip=${caddy_ip:-pending}"
echo "  ollama_lb_ip=${ollama_lb_ip:-n/a}"
echo "  metallb_mode=$metallb_mode"
[[ -n "$hosts_line" ]] && echo "  /etc/hosts: $hosts_line"

{
  echo "# T14.2 deploy package contract"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Release SHA"
  echo "\`$RELEASE_SHA\` (short: \`$RELEASE_SHA_SHORT\`)"
  echo ""
  echo "## Image names + digests"
  echo "| Service | Local image | Docker ID | rp.dev.source-sha | Pod image ID |"
  echo "|---------|-------------|-----------|-------------------|--------------|"
  for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
    img="${svc}:dev"
    digest="missing"
    source_sha="missing"
    if docker image inspect "$img" >/dev/null 2>&1; then
      digest="$(docker image inspect "$img" --format '{{.Id}}' 2>/dev/null || echo missing)"
      source_sha="$(docker image inspect "$img" --format '{{index .Config.Labels "rp.dev.source-sha"}}' 2>/dev/null || echo missing)"
    fi
    pod_name="$(kubectl -n "$NS" get pods -l "app=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo n/a)"
    pod_image_id="$(kubectl -n "$NS" get pod "$pod_name" -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null || echo n/a)"
    echo "| $svc | $img | \`${digest#sha256:}\` | \`$source_sha\` | \`${pod_image_id#docker://}\` |"
  done
  echo ""
  echo "## Kubernetes deployments + pods"
  for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
    deploy_image="$(kubectl -n "$NS" get deployment "$svc" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo n/a)"
    pod_name="$(kubectl -n "$NS" get pods -l "app=$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo n/a)"
    echo "- **$svc**: deployment=\`$deploy_image\` pod=\`$pod_name\`"
  done
  echo ""
  echo "## Edge / Ollama / MetalLB"
  echo "- Caddy LB IP: \`${caddy_ip:-pending}\`"
  echo "- Ollama LB IP: \`${ollama_lb_ip:-n/a}\` (type: \`${ollama_lb_type:-n/a}\`)"
  echo "- MetalLB mode: \`$metallb_mode\`"
  echo "- /etc/hosts: \`$hosts_line\`"
  echo ""
  echo "JSON artifact: \`$REPORT\`"
} >"$CONTRACT"

echo "rp-release-package contract: $CONTRACT"
