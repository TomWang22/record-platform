#!/usr/bin/env bash
# Prisma generate with retries (transient binaries.prisma.sh / network in Colima build VM).
# Usage: prisma-generate-retry.sh <path-to-service-dir>
set -euo pipefail
svc_dir="${1:?service directory (e.g. services/messaging-service)}"
cd "$svc_dir"
MAX="${PRISMA_GENERATE_RETRIES:-5}"
for attempt in $(seq 1 "$MAX"); do
  if pnpm exec prisma generate; then
    exit 0
  fi
  rc=$?
  echo "prisma generate failed (exit $rc, attempt $attempt/$MAX)" >&2
  [[ "$attempt" -lt "$MAX" ]] || exit "$rc"
  sleep "$((attempt * 2))"
done
