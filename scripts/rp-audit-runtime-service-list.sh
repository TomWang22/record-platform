#!/usr/bin/env bash
# Audit active RP runtime image/deploy lists: no booking/social, unique targets, Dockerfiles present.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
_LIB_DIR="$SCRIPT_DIR/lib"
# shellcheck source=scripts/lib/record-platform-docker-services-default.sh
source "$_LIB_DIR/record-platform-docker-services-default.sh"
# shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
source "$_LIB_DIR/rp-runtime-deploy-services.sh"

_fail() { echo "❌ $*" >&2; exit 1; }

_check_no_dupes() {
  local label="$1"
  shift
  local -a items=("$@")
  local -A seen=()
  local x
  for x in "${items[@]}"; do
    [[ -n "$x" ]] || continue
    if [[ -n "${seen[$x]:-}" ]]; then
      _fail "$label: duplicate entry '$x'"
    fi
    seen[$x]=1
  done
}

_check_forbidden() {
  local label="$1"
  shift
  local -a items=("$@")
  local x
  for x in "${items[@]}"; do
    case "$x" in
      booking|social)
        _fail "$label: forbidden legacy RP service '$x'"
        ;;
    esac
  done
}

_dockerfile_for() {
  local svc="$1"
  case "$svc" in
    webapp) echo "$REPO_ROOT/webapp/Dockerfile" ;;
    transport-watchdog) echo "$REPO_ROOT/services/transport-watchdog/Dockerfile" ;;
    *) echo "$REPO_ROOT/services/$svc/Dockerfile" ;;
  esac
}

echo ""
echo "Image build list (RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT + webapp → RP_ACTIVE_IMAGE_TARGETS)"
echo "  source: scripts/lib/record-platform-docker-services-default.sh"
echo "  RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT=$RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT"
echo "  RP_ACTIVE_IMAGE_TARGETS=${RP_ACTIVE_IMAGE_TARGETS[*]}"

echo ""
echo "Deploy / rollout list (RP_RUNTIME_APP_DEPLOYS)"
echo "  source: scripts/lib/rp-runtime-deploy-services.sh"
echo "  ${RP_RUNTIME_APP_DEPLOYS[*]}"

_check_forbidden "RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT" ${RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT}
_check_forbidden "RP_ACTIVE_IMAGE_TARGETS" "${RP_ACTIVE_IMAGE_TARGETS[@]}"
_check_forbidden "RP_RUNTIME_APP_DEPLOYS" "${RP_RUNTIME_APP_DEPLOYS[@]}"

_check_no_dupes "RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT" ${RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT}
_check_no_dupes "RP_ACTIVE_IMAGE_TARGETS" "${RP_ACTIVE_IMAGE_TARGETS[@]}"
_check_no_dupes "RP_RUNTIME_APP_DEPLOYS" "${RP_RUNTIME_APP_DEPLOYS[@]}"

if printf '%s\n' "${RP_ACTIVE_IMAGE_TARGETS[@]}" | grep -qxF webapp; then
  if printf '%s\n' ${RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT} | grep -qxF webapp; then
    _fail "webapp must not appear in RECORD_PLATFORM_DOCKER_SERVICES_DEFAULT (append once at call sites)"
  fi
fi

df_missing=0
for svc in "${RP_ACTIVE_IMAGE_TARGETS[@]}"; do
  df="$(_dockerfile_for "$svc")"
  if [[ ! -f "$df" ]]; then
    echo "  ❌ missing Dockerfile for $svc ($df)" >&2
    df_missing=1
  fi
done
[[ "$df_missing" -eq 0 ]] || _fail "one or more image targets lack Dockerfiles"

echo "✅ runtime service lists: no booking/social; all image targets have Dockerfiles; no duplicates"
