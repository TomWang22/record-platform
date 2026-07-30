#!/usr/bin/env bash
# CI workflow service matrices must match RP_ACTIVE_IMAGE_TARGETS / RP_DOCKER_BUILD_SERVICES.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
_LIB_DIR="$SCRIPT_DIR/lib"
# shellcheck source=scripts/lib/record-platform-docker-services-default.sh
source "$_LIB_DIR/record-platform-docker-services-default.sh"

_fail() { echo "audit-rp-ci-service-matrix: FAIL — $*" >&2; exit 1; }

_extract_yaml_matrix() {
  local file="$1"
  local job="$2"
  awk -v job="$job" '
    $0 ~ ("^  " job ":") { in_job=1; next }
    in_job && /^  [a-zA-Z0-9_-]+:/ && $0 !~ ("^  " job ":") { in_job=0 }
    in_job && /^        service:/ { in_matrix=1; next }
    in_matrix && /^          - / { gsub(/^          - /, ""); print }
    in_matrix && /^        [a-zA-Z]/ && $0 !~ /^        service:/ { in_matrix=0 }
  ' "$file"
}

_forbidden() {
  local x
  for x in "$@"; do
    case "$x" in
      cron-jobs) return 0 ;;
    esac
  done
  return 1
}

_check_matrix() {
  local label="$1"
  local file="$2"
  local job="$3"
  shift 3
  local -a expected=("$@")
  local -a actual=()
  mapfile -t actual < <(_extract_yaml_matrix "$file" "$job")

  if _forbidden "${actual[@]}"; then
    _fail "$label ($file job $job) contains forbidden legacy service"
  fi

  local e a missing=0 extra=0
  for e in "${expected[@]}"; do
    local found=0
    for a in "${actual[@]}"; do
      [[ "$a" == "$e" ]] && found=1 && break
    done
    if [[ "$found" -eq 0 ]]; then
      echo "  missing: $e" >&2
      missing=1
    fi
  done
  for a in "${actual[@]}"; do
    local found=0
    for e in "${expected[@]}"; do
      [[ "$a" == "$e" ]] && found=1 && break
    done
    if [[ "$found" -eq 0 ]]; then
      echo "  extra: $a" >&2
      extra=1
    fi
  done
  if [[ "$missing" -eq 1 || "$extra" -eq 1 ]]; then
    _fail "$label ($file job $job) does not match expected RP runtime set"
  fi
  echo "  OK $label (${#actual[@]} services)"
}

BUILD_EXPECTED=("${RP_DOCKER_BUILD_SERVICES[@]}")
DOCKER_EXPECTED=("${RP_ACTIVE_IMAGE_TARGETS[@]}")

CI_FILE="$REPO_ROOT/.github/workflows/ci.yml"
DOCKER_FILE="$REPO_ROOT/.github/workflows/docker-build.yml"

[[ -f "$CI_FILE" ]] || _fail "missing $CI_FILE"
[[ -f "$DOCKER_FILE" ]] || _fail "missing $DOCKER_FILE"

echo "audit-rp-ci-service-matrix"
echo "  expected build/test: ${BUILD_EXPECTED[*]}"
echo "  expected docker: ${DOCKER_EXPECTED[*]}"

_check_matrix "ci build" "$CI_FILE" "build" "${BUILD_EXPECTED[@]}"
_check_matrix "ci test" "$CI_FILE" "test" "${BUILD_EXPECTED[@]}"
_check_matrix "ci docker-build" "$CI_FILE" "docker-build" "${DOCKER_EXPECTED[@]}"
_check_matrix "docker-build workflow" "$DOCKER_FILE" "build-images" "${DOCKER_EXPECTED[@]}"

echo "audit-rp-ci-service-matrix: PASS"
