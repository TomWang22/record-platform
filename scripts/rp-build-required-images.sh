#!/usr/bin/env bash
# Build diagnostic edge images required by infra/required_images.json (host Docker).
# Noisy docker build output → bench_logs/command-logs/C.images/build-*.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
LOG_DIR="${REPO_ROOT}/bench_logs/command-logs/C.images"
mkdir -p "$LOG_DIR"

_rp_build_log_tail() {
  local log="$1"
  if [[ -f "$log" ]]; then
    echo "  --- last 80 lines of $(basename "$log") ---"
    tail -80 "$log" | sed 's/^/    /'
  fi
}

_rp_build_one() {
  local slug="$1" dockerfile="$2" tag="$3"
  local log="${LOG_DIR}/build-${slug}.log"

  if docker image inspect "$tag" >/dev/null 2>&1 && [[ "${RP_FORCE_REBUILD_IMAGES:-0}" != "1" ]]; then
    echo "  ✅ ${tag} (already on host Docker)"
    return 0
  fi

  echo "  ▶ build ${tag}"
  {
    printf '=== %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'docker build -t %s -f %s %s\n\n' "$tag" "$dockerfile" "$REPO_ROOT"
  } >"$log"

  set +e
  docker build -t "$tag" -f "$dockerfile" "$REPO_ROOT" >>"$log" 2>&1
  local ec=$?
  set -e

  if [[ "$ec" -ne 0 ]]; then
    echo "❌ build ${tag} failed (exit ${ec})" >&2
    _rp_build_log_tail "$log"
    return "$ec"
  fi

  docker image inspect "$tag" >/dev/null 2>&1 || {
    echo "❌ build ${tag} finished but image not found on host Docker" >&2
    _rp_build_log_tail "$log"
    return 1
  }
  echo "  ✅ ${tag}"
  return 0
}

printf '[C.images] build required diagnostic images\n'
printf '  caddy-with-tcpdump:dev ← docker/caddy-with-debug-tools.Dockerfile (caddy, xcaddy, tcpdump, tshark, strace, htop, curl)\n'
printf '  envoy-with-tcpdump:dev ← docker/envoy-with-debug-tools.Dockerfile\n'

_ec=0
_rp_build_one caddy-with-tcpdump docker/caddy-with-debug-tools.Dockerfile caddy-with-tcpdump:dev || _ec=$?
_rp_build_one envoy-with-tcpdump docker/envoy-with-debug-tools.Dockerfile envoy-with-tcpdump:dev || _ec=$?

if [[ "$_ec" -ne 0 ]]; then
  echo "❌ rp-build-required-images failed — see ${LOG_DIR}/build-*.log" >&2
  exit "$_ec"
fi

echo "✅ required diagnostic images built on host Docker"

if [[ -f "$SCRIPT_DIR/smoke-rp-caddy-debug-tools.sh" ]]; then
  echo "  ▶ verify caddy-with-tcpdump:dev tools (caddy, tcpdump, tshark, strace, htop, curl)"
  RP_CADDY_DEBUG_IMAGE=caddy-with-tcpdump:dev bash "$SCRIPT_DIR/smoke-rp-caddy-debug-tools.sh" || _ec=1
fi

if [[ "${_ec:-0}" -ne 0 ]]; then
  echo "❌ rp-build-required-images failed (build or caddy tools smoke)" >&2
  exit "$_ec"
fi
