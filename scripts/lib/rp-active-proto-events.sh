#!/usr/bin/env bash
# Active RP event proto stems (source only). booking/social are never derived when skip flags are on.
#
# shellcheck source=rp-proto-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-proto-env.sh"

# Canonical Kafka topic stems for Record Platform (auction_monitor optional for auction-monitor service).
RP_ACTIVE_EVENT_PROTO_STEMS=(
  auth
  records
  listing
  shopping
  messaging
  media
  notification
  trust
  analytics
  ai
  auction_monitor
)

RP_LEGACY_EVENT_PROTO_STEMS=(booking social)

rp_proto_stem_excluded() {
  local base="$1"
  rp_apply_proto_skip_env
  if [[ "${RP_SKIP_BOOKING_SERVICE}" == "1" && "$base" == "booking" ]]; then
    return 0
  fi
  if [[ "${RP_SKIP_SOCIAL_SERVICE}" == "1" && "$base" == "social" ]]; then
    return 0
  fi
  return 1
}

rp_expected_kafka_topic_for_stem() {
  local stem="$1"
  local env_prefix="${ENV_PREFIX:-dev}"
  local suf="${2:-}"
  if [[ "$stem" == "messaging" ]]; then
    printf '%s' "messaging.events.v1"
    return 0
  fi
  printf '%s' "${env_prefix}.${stem}.events${suf}"
}
