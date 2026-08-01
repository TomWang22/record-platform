#!/usr/bin/env bash
# Active RP :dev image targets (excluded legacy peers are not listed).
set -euo pipefail

# Backend + edge services (build/deploy lists append webapp once — see record-platform-docker-services-default.sh).
RP_DOCKER_BUILD_SERVICES=(
  api-gateway
  auth-service
  records-service
  listings-service
  shopping-service
  messaging-service
  media-service
  trust-service
  notification-service
  analytics-service
  python-ai-service
  auction-monitor
  transport-watchdog
  ollama-gateway
  ollama-worker
)

# Full freshness / audit target set (exactly one webapp).
RP_ACTIVE_IMAGE_TARGETS=(
  "${RP_DOCKER_BUILD_SERVICES[@]}"
  webapp
)
