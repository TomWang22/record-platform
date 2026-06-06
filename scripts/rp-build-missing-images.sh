#!/usr/bin/env bash
# Build only stale/missing :dev images, then require 14/14 fresh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"
# shellcheck source=lib/rp-docker-lib.sh
source "$SCRIPT_DIR/lib/rp-docker-lib.sh"
IMAGE_TAG="${IMAGE_TAG:-dev}"
BUILD_LOG_DIR="${RP_BUILD_LOG_DIR:-$REPO_ROOT/bench_logs/image-build}"
mkdir -p "$BUILD_LOG_DIR"

missing=()
fresh=()
built=()
failed=()

echo ""
echo "E.build_images — sequential runtime :dev builds (${#RP_ACTIVE_IMAGE_TARGETS[@]} targets)"
echo "  order: ${RP_ACTIVE_IMAGE_TARGETS[*]}"
echo "  logs:  ${BUILD_LOG_DIR}/<service>-${IMAGE_TAG}.log"
echo ""

echo "▶ pre-pull base images (once, before builds)"
bash "$SCRIPT_DIR/rp-prepull-base-images.sh"
export RP_BASE_IMAGE_PREPULL_DONE=1

echo ""
echo "▶ image freshness pre-check (labeled image required to skip; hash cache is advisory only)"
for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
  sha="$(bash "$SCRIPT_DIR/lib/rp-compute-source-sha.sh" "$svc")"
  if rp_docker_image_fresh_for_service "$svc" "$IMAGE_TAG"; then
    fresh+=("$svc")
    echo "  ⏭️  ${svc}:${IMAGE_TAG} fresh (labeled) sha=${sha:0:12}…"
  else
    missing+=("$svc")
    echo "  🔨 need build ${svc}:${IMAGE_TAG} expected_sha=${sha}"
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  echo ""
  echo "✅ all ${#RP_ACTIVE_IMAGE_TARGETS[@]} images already fresh — skipping docker build"
  bash "$SCRIPT_DIR/audit-rp-image-freshness.sh"
  exit 0
fi

echo ""
echo "Building ${#missing[@]}/${#RP_ACTIVE_IMAGE_TARGETS[@]} stale/missing image(s) (sequential):"
printf '  %s\n' "${missing[@]}"
echo ""

for svc in "${missing[@]}"; do
  log="$BUILD_LOG_DIR/${svc}-${IMAGE_TAG}.log"
  echo "════════════════════════════════════════"
  echo "▶ START Build: ${svc}:${IMAGE_TAG}"
  echo "  log: ${log}"
  echo "════════════════════════════════════════"
  if ! SERVICES="$svc" RP_SKIP_FRESH_BUILD=0 RP_SKIP_BASE_IMAGE_PREPULL=1 RP_BASE_IMAGE_PREPULL_DONE=1 \
     bash "$SCRIPT_DIR/build-record-platform-images-k3s.sh" 2>&1 | tee "$log"; then
  failed+=("$svc")
    echo ""
    echo "❌ END Build: ${svc}:${IMAGE_TAG} FAILED" >&2
    echo "  Dockerfile: $( [[ "$svc" == webapp ]] && echo webapp/Dockerfile || echo "services/$svc/Dockerfile")" >&2
    echo "  log: ${log}" >&2
    echo "  resume: SERVICES=\"${svc}\" RP_SKIP_FRESH_BUILD=0 RP_SKIP_BASE_IMAGE_PREPULL=1 make build-images" >&2
    exit 1
  fi
  if ! RP_IMAGE_TARGETS="$svc" bash "$SCRIPT_DIR/audit-rp-image-freshness.sh"; then
    failed+=("$svc")
    echo ""
    echo "❌ END Build: ${svc}:${IMAGE_TAG} freshness audit FAILED" >&2
    echo "  log: ${log}" >&2
    exit 1
  fi
  built+=("$svc")
  echo "✅ END Build: ${svc}:${IMAGE_TAG} fresh"
done

echo ""
echo "▶ full freshness audit (${#RP_ACTIVE_IMAGE_TARGETS[@]} active targets)"
bash "$SCRIPT_DIR/audit-rp-image-freshness.sh"

echo ""
echo "E.build_images summary"
printf '  %-12s %s\n' "built" "${#built[@]}/${#RP_ACTIVE_IMAGE_TARGETS[@]} (${built[*]:-none})"
printf '  %-12s %s\n' "skipped" "${#fresh[@]}/${#RP_ACTIVE_IMAGE_TARGETS[@]} (${fresh[*]:-none})"
printf '  %-12s %s\n' "failed" "${#failed[@]}"
printf '  %-12s %s\n' "log_dir" "$BUILD_LOG_DIR"
echo "✅ E.build_images complete"
