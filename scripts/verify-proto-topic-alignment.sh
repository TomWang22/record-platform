#!/usr/bin/env bash
# Verify active RP proto/events ↔ Kafka topic naming (mirror only; never inspects booking/social).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-proto-env.sh
source "$SCRIPT_DIR/lib/rp-proto-env.sh"
# shellcheck source=lib/rp-active-proto-events.sh
source "$SCRIPT_DIR/lib/rp-active-proto-events.sh"
# shellcheck source=lib/rp-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/rp-kafka-event-topics-from-proto.sh"

rp_apply_proto_skip_env
export REPO_ROOT
export PROTO_EVENTS_ROOT="${PROTO_EVENTS_ROOT:-$(rp_proto_events_mirror_root)}"
export ENV_PREFIX="${ENV_PREFIX:-dev}"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

SUF=""
raw="${RP_KAFKA_TOPIC_SUFFIX:-${OCH_KAFKA_TOPIC_SUFFIX:-}}"
raw="${raw#"${raw%%[![:space:]]*}"}"
raw="${raw%"${raw##*[![:space:]]}"}"
while [[ "$raw" == .* ]]; do raw="${raw#.}"; done
[[ -n "$raw" ]] && SUF=".${raw}"
export SUF

[[ -d "$PROTO_EVENTS_ROOT" ]] || fail "Missing mirror: $PROTO_EVENTS_ROOT"

rp_kafka_event_topics_fill || fail "Could not build RP topic list"

rp_topic_list_contains() {
  local needle="$1" t
  for t in "${RP_KAFKA_EVENT_TOPICS[@]}"; do
    [[ "$t" == "$needle" ]] && return 0
  done
  return 1
}

for stem in "${RP_LEGACY_EVENT_PROTO_STEMS[@]}"; do
  if [[ -f "$PROTO_EVENTS_ROOT/${stem}.proto" ]]; then
    fail "Legacy proto still in mirror: ${stem}.proto (re-run sync-rp-proto-contract.sh)"
  fi
done

for stem in "${RP_ACTIVE_EVENT_PROTO_STEMS[@]}"; do
  rp_proto_stem_excluded "$stem" && continue
  [[ -f "$PROTO_EVENTS_ROOT/${stem}.proto" ]] || fail "Missing mirror proto: ${stem}.proto"
  exp="$(rp_expected_kafka_topic_for_stem "$stem" "$SUF")"
  rp_topic_list_contains "$exp" || fail "Missing topic '$exp' for active proto ${stem}.proto"
done

rp_topic_list_contains "${ENV_PREFIX}.messaging.dlq${SUF}" || fail "Missing ${ENV_PREFIX}.messaging.dlq${SUF}"

for forbidden in booking social; do
  for t in "${RP_KAFKA_EVENT_TOPICS[@]}"; do
    [[ "$t" == *".${forbidden}."* ]] && fail "Forbidden topic in RP list: $t"
  done
done

ok "proto/events ↔ Kafka topic naming OK (${#RP_KAFKA_EVENT_TOPICS[@]} topics, mirror=$PROTO_EVENTS_ROOT)"
