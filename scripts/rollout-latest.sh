#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
bash scripts/build-and-load.sh "${1:-h3}"

kubectl -n "$NS" rollout restart deploy/api-gateway \
  deploy/auth-service deploy/records-service deploy/listings-service \
  deploy/analytics-service deploy/python-ai-service \
  deploy/auction-monitor deploy/cron-jobs

kubectl -n "$NS" rollout status deploy/records-service
