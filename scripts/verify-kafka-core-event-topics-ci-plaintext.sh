#!/usr/bin/env bash
# GitHub Actions / local plaintext broker: ensure core RP domain event topics exist.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/rp-proto-env.sh
source "$SCRIPT_DIR/lib/rp-proto-env.sh"
rp_apply_proto_skip_env
export REPO_ROOT ENV_PREFIX="${ENV_PREFIX:-dev}"
export PROTO_EVENTS_ROOT="${PROTO_EVENTS_ROOT:-$REPO_ROOT/infra/k8s/base/config/proto/events}"

BS="${KAFKA_BROKER:-127.0.0.1:9092}"
IMG="${KAFKA_TOOLS_IMAGE:-confluentinc/cp-kafka:7.5.0}"

# shellcheck source=lib/rp-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/rp-kafka-event-topics-from-proto.sh"
export SUF=""
rp_kafka_event_topics_fill || { echo "❌ topic list" >&2; exit 1; }
topics=("${RP_KAFKA_EVENT_TOPICS[@]}")

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker required" >&2
  exit 1
fi

kt() {
  docker run --rm --network=host "$IMG" kafka-topics --bootstrap-server "$BS" "$@"
}

for t in "${topics[@]}"; do
  [[ "$t" == *".booking."* || "$t" == *".social."* ]] && continue
  echo "→ $t"
  kt --create --if-not-exists --topic "$t" --partitions 1 --replication-factor 1
  kt --describe --topic "$t" >/dev/null
  echo "  ✅ describe ok"
done

echo "✅ Core Kafka event topics on $BS (${#topics[@]} topics, prefix=$ENV_PREFIX)"
