#!/usr/bin/env bash
# Derive RP_KAFKA_EVENT_TOPICS from active proto/events mirror only (no booking/social when skipped).
#
# Requires: REPO_ROOT, ENV_PREFIX, SUF (optional isolation suffix)
# Sets: RP_KAFKA_EVENT_TOPICS (and OCH_KAFKA_EVENT_TOPICS alias for legacy callers)
#
# shellcheck source=rp-proto-env.sh
# shellcheck source=rp-active-proto-events.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-proto-env.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-active-proto-events.sh"

rp_kafka_event_topics_fill() {
  RP_KAFKA_EVENT_TOPICS=()
  OCH_KAFKA_EVENT_TOPICS=()
  rp_apply_proto_skip_env

  local proto_root
  proto_root="$(rp_proto_events_mirror_root)"
  if [[ ! -d "$proto_root" ]]; then
    echo "❌ Proto events mirror not found: $proto_root (run sync-rp-proto-contract.sh)" >&2
    return 1
  fi

  local stem suf="${SUF:-}"
  local tmp_topics=()

  for stem in "${RP_ACTIVE_EVENT_PROTO_STEMS[@]}"; do
    rp_proto_stem_excluded "$stem" && continue
    [[ -f "$proto_root/${stem}.proto" ]] || {
      echo "❌ Missing active event proto: $proto_root/${stem}.proto" >&2
      return 1
    }
    tmp_topics+=("$(rp_expected_kafka_topic_for_stem "$stem" "$suf")")
  done

  tmp_topics+=("${ENV_PREFIX:-dev}.messaging.dlq${suf}")
  tmp_topics+=("${ENV_PREFIX:-dev}.community.events.v1${suf}")
  tmp_topics+=("${ENV_PREFIX:-dev}.user.lifecycle.v1${suf}")
  tmp_topics+=("${ENV_PREFIX:-dev}.user.lifecycle.ack.v1${suf}")

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    RP_KAFKA_EVENT_TOPICS+=("$line")
  done < <(printf '%s\n' "${tmp_topics[@]}" | LC_ALL=C sort -u)

  OCH_KAFKA_EVENT_TOPICS=("${RP_KAFKA_EVENT_TOPICS[@]}")
}

# Legacy function name
och_kafka_event_topics_fill() {
  rp_kafka_event_topics_fill "$@"
}
