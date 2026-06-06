#!/usr/bin/env sh
# Activate pnpm; prefer vendored npm tarball (no registry.npmjs.org in build VM).
set -eu
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM_VER="${RP_PNPM_VERSION:-11.1.3}"
VENDOR="/tmp/rp-vendor/pnpm-${PNPM_VER}.tgz"

corepack enable
if [ -f "$VENDOR" ]; then
  rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx 2>/dev/null || true
  npm install -g --force "$VENDOR"
else
  corepack prepare "pnpm@${PNPM_VER}" --activate
fi
