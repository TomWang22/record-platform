#!/usr/bin/env sh
# Non-interactive pnpm for Docker/CI (pnpm 11 strictDepBuilds / ERR_PNPM_IGNORED_BUILDS).
# Usage in Dockerfiles: rp-pnpm -w --filter 'svc...' install --frozen-lockfile [--ignore-scripts]
set -eu
export CI=true
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export npm_config_dangerously_allow_all_builds=true
export NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
export npm_config_confirmModulesPurge=false
export NPM_CONFIG_CONFIRM_MODULES_PURGE=false
export PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
MAX="${RP_PNPM_INSTALL_RETRIES:-3}"
DELAY="${RP_PNPM_INSTALL_RETRY_DELAY_SEC:-5}"
attempt=1
while [ "$attempt" -le "$MAX" ]; do
  if pnpm "$@"; then
    exit 0
  fi
  rc=$?
  if [ "$attempt" -ge "$MAX" ]; then
    exit "$rc"
  fi
  echo "rp-pnpm: attempt $attempt/$MAX failed (exit $rc); retrying in ${DELAY}s" >&2
  sleep "$DELAY"
  attempt=$((attempt + 1))
done
