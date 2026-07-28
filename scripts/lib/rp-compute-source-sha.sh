#!/usr/bin/env bash
# Compute deterministic per-service source hash for rp.dev.source-sha image labels.
# Usage: rp-compute-source-sha.sh <service-name>
#   api-gateway | auth-service | webapp | python-ai-service | transport-watchdog | …
set -euo pipefail

svc="${1:?service name (e.g. auth-service, webapp)}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

EXCLUDE_DIR_RE='(node_modules|dist|\.next|\.turbo|bench_logs|backups|\.git|coverage|\.cache|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|htmlcov)(/|$)'
EXCLUDE_FILE_RE='\.(map|log|pem|crt|key|jks|p12|pyc)$'

hash_paths() {
  # Exclude host-local venvs/caches from image source SHAs (python-ai-service/.venv was
  # previously hashed and made E.build_images fail mid pre-check under set -o pipefail).
  # Use find -prune instead of grep|pipefail so an empty filter never aborts the script.
  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2068
  find "$@" \( \
      -name node_modules -o -name dist -o -name .next -o -name .turbo -o \
      -name bench_logs -o -name backups -o -name .git -o -name coverage -o \
      -name .cache -o -name .venv -o -name venv -o -name __pycache__ -o \
      -name .pytest_cache -o -name .mypy_cache -o -name .ruff_cache -o \
      -name .tox -o -name htmlcov \
    \) -prune -o -type f -print 2>/dev/null \
    | grep -Ev "$EXCLUDE_FILE_RE" \
    | LC_ALL=C sort >"$tmp" || true
  if [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    echo "error: no hashable files for: $*" >&2
    return 1
  fi
  # xargs -n batches automatically; ignore per-file shasum noise, require aggregate output.
  local sha
  sha="$(xargs -n 200 shasum -a 256 <"$tmp" 2>/dev/null | shasum -a 256 | awk '{print $1}')"
  rm -f "$tmp"
  [[ -n "$sha" ]] || return 1
  printf '%s\n' "$sha"
}



inputs=()
extras=()
include_common=0
include_proto=0
include_workspace=1

case "$svc" in
  webapp)
    inputs+=(webapp)
    extras+=(webapp/Dockerfile tsconfig.base.json)
    include_common=0
    include_proto=0
    ;;
  python-ai-service)
    inputs+=(services/python-ai-service)
    extras+=(
      services/python-ai-service/Dockerfile
      services/python-ai-service/requirements.txt
    )
    [[ -f services/python-ai-service/pyproject.toml ]] && extras+=(services/python-ai-service/pyproject.toml)
    # Dockerfile copies Phase 33/34 runners into the image — include in freshness hash.
    [[ -d scripts/ai-platform ]] && inputs+=(scripts/ai-platform)
    [[ -d scripts/lib ]] && inputs+=(scripts/lib)
    include_proto=1
    ;;
  transport-watchdog)
    inputs+=(services/transport-watchdog)
    extras+=(services/transport-watchdog/Dockerfile)
    include_common=0
    include_proto=0
    ;;
  booking-service|social-service)
    echo "error: $svc is not an active RP image target" >&2
    exit 2
    ;;
  *)
    if [[ ! -d "services/$svc" ]]; then
      echo "error: missing services/$svc" >&2
      exit 1
    fi
    inputs+=("services/$svc")
    extras+=("services/$svc/Dockerfile")
    include_common=1
    include_proto=1
    ;;
esac

[[ $include_common -eq 1 ]] && inputs+=("services/common")
[[ $include_proto -eq 1 && -d proto ]] && inputs+=("proto")
# Frozen vendored + docker build helpers (do not change without rebuilding all :dev images).
case "$svc" in
  auth-service|records-service|listings-service|shopping-service|messaging-service|media-service|trust-service|notification-service|analytics-service|python-ai-service|auction-monitor)
    [[ -d scripts/vendor ]] && inputs+=("scripts/vendor")
    ;;
esac
case "$svc" in
  api-gateway|auth-service|records-service|listings-service|shopping-service|messaging-service|media-service|trust-service|notification-service|analytics-service|auction-monitor|webapp)
    for f in scripts/docker/rp-corepack-pnpm.sh scripts/docker/rp-pnpm-ci-install.sh; do
      [[ -f "$f" ]] && extras+=("$f")
    done
    [[ -f scripts/vendor/pnpm-11.1.3.tgz ]] && extras+=("scripts/vendor/pnpm-11.1.3.tgz")
    ;;
esac
case "$svc" in
  auth-service|records-service|messaging-service|shopping-service)
    [[ -f scripts/docker/prisma-generate-retry.sh ]] && extras+=("scripts/docker/prisma-generate-retry.sh")
    ;;
esac
if [[ $include_workspace -eq 1 ]]; then
  for f in package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json; do
    [[ -f "$f" ]] && extras+=("$f")
  done
fi

# Per-service tsconfig
for tc in "services/$svc/tsconfig.json" "services/$svc/tsconfig.build.json"; do
  [[ -f "$tc" ]] && extras+=("$tc")
done

file_args=()
for d in "${inputs[@]}"; do
  [[ -e "$d" ]] && file_args+=("$d")
done
for f in "${extras[@]}"; do
  [[ -e "$f" ]] && file_args+=("$f")
done

if [[ ${#file_args[@]} -eq 0 ]]; then
  echo "error: no inputs for $svc" >&2
  exit 1
fi

sha="$(hash_paths "${file_args[@]}")"
[[ -n "$sha" ]] || { echo "error: empty hash for $svc" >&2; exit 1; }
echo "$sha"
