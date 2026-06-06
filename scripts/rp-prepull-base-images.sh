#!/usr/bin/env bash
# Pre-pull base images used by active RP :dev Dockerfiles (retry/backoff).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DOCKER="${DOCKER:-docker}"
MAX_ATTEMPTS="${RP_BASE_IMAGE_PULL_ATTEMPTS:-5}"
RETRY_DELAY="${RP_BASE_IMAGE_PULL_DELAY_SEC:-5}"

# shellcheck source=lib/rp-active-image-targets.sh
source "$SCRIPT_DIR/lib/rp-active-image-targets.sh"

discover_bases() {
  local df bases=()
  for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
    case "$svc" in
      webapp) df="webapp/Dockerfile" ;;
      *) df="services/$svc/Dockerfile" ;;
    esac
    [[ -f "$df" ]] || continue
    while IFS= read -r img; do
      [[ -n "$img" ]] && bases+=("$img")
    done < <(
      awk '/^FROM / {
        gsub(/^FROM /,""); gsub(/ AS .*/,""); gsub(/ as .*/,"");
        if ($1 !~ /^scratch$/ && $1 !~ /^--platform=/) print $1
      }' "$df" 2>/dev/null | sort -u
    )
  done
  printf '%s\n' "${bases[@]}" | LC_ALL=C sort -u
}

# Explicit fallbacks if discovery misses anything
REQUIRED_BASES=(
  node:22-bookworm-slim
  node:22-alpine
  python:3.11-slim
  docker/dockerfile:1
)

mapfile -t DISCOVERED < <(discover_bases)
BASE_IMAGES=()
declare -A _seen=()
for img in "${REQUIRED_BASES[@]}" "${DISCOVERED[@]}"; do
  [[ -z "$img" ]] && continue
  [[ -n "${_seen[$img]:-}" ]] && continue
  _seen[$img]=1
  BASE_IMAGES+=("$img")
done

pull_one() {
  local image="$1"
  if $DOCKER image inspect "$image" >/dev/null 2>&1; then
    echo "✅ base image already local: ${image}"
    return 0
  fi
  local attempt=1
  while [[ $attempt -le $MAX_ATTEMPTS ]]; do
    echo "▶ pulling base image ${image} attempt ${attempt}/${MAX_ATTEMPTS}"
    if $DOCKER pull "$image"; then
      echo "✅ base image ready: ${image}"
      return 0
    fi
    if $DOCKER image inspect "$image" >/dev/null 2>&1; then
      echo "✅ base image present after pull error (using local): ${image}"
      return 0
    fi
    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      echo "⚠️  pull failed; retrying in ${RETRY_DELAY}s"
      sleep "$RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done
  if $DOCKER image inspect "$image" >/dev/null 2>&1; then
    echo "✅ base image present locally despite pull failures: ${image}"
    return 0
  fi
  echo "❌ base image pull failed after ${MAX_ATTEMPTS} attempts: ${image}" >&2
  return 1
}

failed=0
echo "Base images to pre-pull (${#BASE_IMAGES[@]}):"
printf '  - %s\n' "${BASE_IMAGES[@]}"

for img in "${BASE_IMAGES[@]}"; do
  pull_one "$img" || failed=$((failed + 1))
done

VENDOR_DIR="$REPO_ROOT/scripts/vendor"
mkdir -p "$VENDOR_DIR"
GRPC_VER="${GRPC_HEALTH_PROBE_VERSION:-v0.4.24}"

verify_grpc_probe() {
  local dest="$1" arch="$2"
  [[ -f "$dest" ]] || return 1
  local sz
  sz=$(wc -c <"$dest" | tr -d ' ')
  [[ "$sz" -gt 1000000 ]] || return 1
  file "$dest" 2>/dev/null | grep -qE "ELF .*executable.*(${arch}|aarch64|x86-64)" || return 1
  return 0
}

for arch in arm64 amd64; do
  dest="$VENDOR_DIR/grpc_health_probe-linux-${arch}"
  if verify_grpc_probe "$dest" "$arch"; then
    echo "✅ grpc-health-probe already vendored: ${dest}"
    continue
  fi
  url="https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_VER}/grpc_health_probe-linux-${arch}"
  attempt=1
  while [[ $attempt -le $MAX_ATTEMPTS ]]; do
    echo "▶ fetching grpc-health-probe ${arch} attempt ${attempt}/${MAX_ATTEMPTS}"
    tmp="${dest}.tmp.$$"
    if curl -Lf --connect-timeout 30 --max-time 120 -o "$tmp" "$url" \
      && chmod +x "$tmp" \
      && verify_grpc_probe "$tmp" "$arch"; then
      mv -f "$tmp" "$dest"
      echo "✅ grpc-health-probe vendored: ${dest}"
      break
    fi
    rm -f "$tmp"
    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      echo "⚠️  grpc-health-probe ${arch} fetch failed; retrying in ${RETRY_DELAY}s"
      sleep "$RETRY_DELAY"
    else
      echo "❌ grpc-health-probe ${arch} fetch failed after ${MAX_ATTEMPTS} attempts" >&2
      failed=$((failed + 1))
    fi
    attempt=$((attempt + 1))
  done
done

PNPM_VER="${RP_PNPM_VERSION:-11.1.3}"
pnpm_dest="$VENDOR_DIR/pnpm-${PNPM_VER}.tgz"
pnpm_url="https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VER}.tgz"
verify_pnpm_tgz() {
  local dest="$1"
  [[ -f "$dest" ]] || return 1
  local sz
  sz=$(wc -c <"$dest" | tr -d ' ')
  [[ "$sz" -gt 500000 ]] || return 1
  tar -tzf "$dest" package/package.json >/dev/null 2>&1 || return 1
  return 0
}
if verify_pnpm_tgz "$pnpm_dest"; then
  echo "✅ pnpm already vendored: ${pnpm_dest}"
else
  attempt=1
  while [[ $attempt -le $MAX_ATTEMPTS ]]; do
    echo "▶ fetching pnpm ${PNPM_VER} attempt ${attempt}/${MAX_ATTEMPTS}"
    tmp="${pnpm_dest}.tmp.$$"
    if curl -Lf --connect-timeout 30 --max-time 180 -o "$tmp" "$pnpm_url" \
      && verify_pnpm_tgz "$tmp"; then
      mv -f "$tmp" "$pnpm_dest"
      echo "✅ pnpm vendored: ${pnpm_dest}"
      break
    fi
    rm -f "$tmp"
    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      echo "⚠️  pnpm fetch failed; retrying in ${RETRY_DELAY}s"
      sleep "$RETRY_DELAY"
    else
      echo "❌ pnpm fetch failed after ${MAX_ATTEMPTS} attempts" >&2
      failed=$((failed + 1))
    fi
    attempt=$((attempt + 1))
  done
fi

if [[ $failed -gt 0 ]]; then
  echo ""
  echo "❌ rp-prepull-base-images: ${failed} base image(s) failed" >&2
  echo "Diagnostics:" >&2
  echo "  DOCKER=$DOCKER" >&2
  $DOCKER info 2>&1 | head -20 >&2 || true
  exit 1
fi
echo ""
echo "✅ rp-prepull-base-images: all base images ready"
