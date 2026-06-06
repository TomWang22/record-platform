#!/usr/bin/env bash
# Human-readable summary of rp-compute-source-sha inputs for one service.
set -euo pipefail
svc="${1:?service}"
case "$svc" in
  webapp) echo "webapp/ + Dockerfile + lockfiles + rp-corepack + pnpm vendor" ;;
  python-ai-service) echo "service/ + proto/ + scripts/vendor + Dockerfile + lockfiles" ;;
  transport-watchdog) echo "service/ + Dockerfile + lockfiles" ;;
  api-gateway) echo "service/ + common/ + proto/ + Dockerfile + lockfiles + docker build scripts + pnpm vendor" ;;
  auth-service|records-service|listings-service|shopping-service|messaging-service|media-service|trust-service|notification-service|analytics-service|auction-monitor)
    echo "service/ + common/ + proto/ + scripts/vendor + Dockerfile + lockfiles + docker build scripts + pnpm vendor"
    ;;
  *) echo "service/ + Dockerfile + lockfiles" ;;
esac
