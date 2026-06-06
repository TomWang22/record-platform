#!/usr/bin/env bash
# RP proto/Kafka skip flags and mirror paths (source only).
rp_apply_proto_skip_env() {
  export RP_SKIP_BOOKING_SERVICE="${RP_SKIP_BOOKING_SERVICE:-${RP_SKIP_BOOKING_DB:-1}}"
  export RP_SKIP_SOCIAL_SERVICE="${RP_SKIP_SOCIAL_SERVICE:-1}"
}

rp_proto_events_mirror_root() {
  local root="${RP_PROTO_EVENTS_MIRROR:-${PROTO_EVENTS_ROOT:-}}"
  if [[ -z "$root" ]]; then
    root="${REPO_ROOT:-}/infra/k8s/base/config/proto/events"
  fi
  printf '%s' "$root"
}
