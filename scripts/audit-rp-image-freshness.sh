#!/usr/bin/env bash
# Verify local :dev images carry rp.dev.source-sha matching current source (hard gate before deploy).
# Usage:
#   bash scripts/audit-rp-image-freshness.sh
#   bash scripts/audit-rp-image-freshness.sh trust-service webapp
#   RP_IMAGE_TARGETS="trust-service" bash scripts/audit-rp-image-freshness.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"
# shellcheck source=lib/rp-docker-lib.sh
source "$SCRIPT_DIR/lib/rp-docker-lib.sh"

IMAGE_TAG="${IMAGE_TAG:-dev}"
AUDIT_CLUSTER="${AUDIT_CLUSTER:-0}"
NS="${RP_K8S_NS:-record-platform}"
DOCKER="${DOCKER:-docker}"
RP_DOCKER="$DOCKER"
DOCKER_INSPECT_ATTEMPTS="${RP_DOCKER_INSPECT_ATTEMPTS:-8}"
DOCKER_INSPECT_DELAY_SEC="${RP_DOCKER_INSPECT_DELAY_SEC:-1}"

docker_inspect() {
  rp_docker_inspect_label "$1" "$2"
}

docker_image_exists() {
  rp_docker_image_id "$1" >/dev/null 2>&1
}

# Target list: CLI args > RP_IMAGE_TARGETS > all active
TARGETS=()
if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
elif [[ -n "${RP_IMAGE_TARGETS:-}" ]]; then
  # shellcheck disable=SC2206
  TARGETS=(${RP_IMAGE_TARGETS//,/ })
else
  TARGETS=("${RP_ACTIVE_IMAGE_TARGETS[@]}")
fi

issues=()
oks=()
warns=()
rows=()

pad() { printf '%-24s' "$1"; }

audit_one() {
  local svc="$1"
  local img="${svc}:${IMAGE_TAG}"
  local expected_sha expected_svc
  expected_sha="$(bash "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" "$svc")"
  expected_svc="$svc"

  local svc_l="missing" sha_l="missing" rev_l="missing" status="stale"

  if ! docker_image_exists "$img"; then
    say_fail "${svc}: local image ${img} missing — run make build-images"
    rows+=("$svc|$img|missing|missing|missing|missing")
    return
  fi

  local img_svc img_sha img_rev
  img_svc="$(docker_inspect '{{index .Config.Labels "rp.dev.service"}}' "$img" || true)"
  img_sha="$(docker_inspect '{{index .Config.Labels "rp.dev.source-sha"}}' "$img" || true)"
  img_rev="$(docker_inspect '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$img" || true)"
  sleep 0.25

  [[ -n "$img_svc" && "$img_svc" == "$expected_svc" ]] && svc_l="ok" || svc_l="bad"
  [[ -n "$img_sha" && "$img_sha" == "$expected_sha" ]] && sha_l="ok" || sha_l="bad"
  [[ -n "$img_rev" && "$img_rev" != "unknown" ]] && rev_l="ok" || rev_l="bad"

  if [[ "$svc_l" == "ok" && "$sha_l" == "ok" && "$rev_l" == "ok" ]]; then
    status="fresh"
    say_ok "${svc}: image fresh ${img_sha}"
    rows+=("$svc|$img|$svc_l|$sha_l|$rev_l|$status")
    return
  fi

  if [[ "$svc_l" != "ok" ]]; then
    say_fail "${svc}: missing or wrong rp.dev.service on ${img} (got=${img_svc:-<empty>})"
  elif [[ "$sha_l" != "ok" ]]; then
    if [[ -z "$img_sha" ]]; then
      say_fail "${svc}: missing label rp.dev.source-sha on ${img}"
    else
      say_fail "${svc}: stale image label=${img_sha} expected=${expected_sha}"
    fi
  elif [[ "$rev_l" != "ok" ]]; then
    say_fail "${svc}: missing org.opencontainers.image.revision on ${img}"
  fi
  rows+=("$svc|$img|$svc_l|$sha_l|$rev_l|$status")
}

say_ok() { oks+=("$1"); echo "✅ $1"; }
say_fail() { issues+=("$1"); echo "❌ $1" >&2; }
say_warn() { warns+=("$1"); echo "⚠️  $1"; }

for forbidden in reservation-mesh; do
  if docker image inspect "${forbidden}:${IMAGE_TAG}" >/dev/null 2>&1; then
    say_warn "${forbidden}:${IMAGE_TAG} exists locally but is not an active RP runtime target"
  fi
done

for svc in "${TARGETS[@]}"; do
  if [[ "$svc" == "reservation-mesh" ]]; then
    say_fail "${svc}: not an active RP image target"
    continue
  fi
  audit_one "$svc"
done

echo ""
printf '%-24s %-22s %-14s %-11s %-9s %-8s\n' \
  "SERVICE" "IMAGE" "SERVICE_LABEL" "SOURCE_SHA" "REVISION" "STATUS"
printf '%-24s %-22s %-14s %-11s %-9s %-8s\n' \
  "------------------------" "----------------------" "--------------" "-----------" "---------" "--------"
for row in "${rows[@]}"; do
  IFS='|' read -r s i sl shl rl st <<<"$row"
  printf '%-24s %-22s %-14s %-11s %-9s %-8s\n' "$s" "$i" "$sl" "$shl" "$rl" "$st"
done

if [[ "${AUDIT_CLUSTER:-0}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
  echo ""
  echo "Cluster image ref audit (namespace=${NS}):"
  for svc in "${TARGETS[@]}"; do
    dep="$svc"
    img_used="$(kubectl get pods -n "$NS" -l "app=$dep" -o jsonpath='{.items[0].spec.containers[0].image}' 2>/dev/null || true)"
    if [[ -z "$img_used" ]]; then
      say_warn "${svc}: no running pod in ${NS}"
    else
      say_ok "${svc}: cluster pod uses ${img_used}"
    fi
  done
fi

OUT_DIR="${OUT_DIR:-$REPO_ROOT/bench_logs/image-freshness-audit}"
mkdir -p "$OUT_DIR"
{
  echo "# Image freshness audit"
  echo ""
  echo "Targets: ${TARGETS[*]}"
  echo "Status: **$([[ ${#issues[@]} -eq 0 ]] && echo pass || echo fail)**"
  echo ""
  echo "## Issues (${#issues[@]})"
  for i in "${issues[@]:-}"; do echo "- $i"; done
  echo ""
  echo "## OK (${#oks[@]})"
  for o in "${oks[@]:-}"; do echo "- $o"; done
} >"$OUT_DIR/report.md"
echo ""
echo "Report: $OUT_DIR/report.md"

if [[ ${#issues[@]} -gt 0 ]]; then
  echo "❌ image freshness audit failed (${#issues[@]} issues, ${#oks[@]}/${#TARGETS[@]} fresh)" >&2
  exit 1
fi
echo "✅ image freshness audit passed (${#oks[@]}/${#TARGETS[@]} images)"
