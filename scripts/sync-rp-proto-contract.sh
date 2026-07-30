#!/usr/bin/env bash
# Sync RP proto + events mirror; validate topics. Any ❌ in output is a hard failure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-proto-env.sh
source "$SCRIPT_DIR/lib/rp-proto-env.sh"
rp_apply_proto_skip_env
export REPO_ROOT ENV_PREFIX="${ENV_PREFIX:-dev}"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

run() {
  if ! "$@" > >(tee -a "$LOG") 2>&1; then
    echo "❌ command failed: $*" >&2
    exit 1
  fi
}

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }

say "Sync service protos → infra/k8s/base/config/proto"
DST="$REPO_ROOT/infra/k8s/base/config/proto"
SRC="$REPO_ROOT/proto"
mkdir -p "$DST"
for f in \
  auth.proto records.proto listings.proto shopping.proto analytics.proto \
  auction-monitor.proto python-ai.proto health.proto common.proto \
  messaging.proto media.proto trust.proto notification.proto; do
  [[ -f "$SRC/$f" ]] || { echo "❌ missing proto/$f" >&2; exit 1; }
  cp -f "$SRC/$f" "$DST/$f"
  echo "  synced $f"
done

say "Sync proto/events → infra/k8s/base/config/proto/events (active RP only; skip booking/social)"
EV_SRC="$SRC/events"
EV_DST="$REPO_ROOT/infra/k8s/base/config/proto/events"
mkdir -p "$EV_DST"
find "$EV_DST" -mindepth 1 -maxdepth 1 ! -name 'README.md' -exec rm -rf {} + 2>/dev/null || true
for f in "$EV_SRC"/*.proto; do
  base=$(basename "$f")
  [[ "$base" == "booking.proto" || "$base" == "social.proto" ]] && continue
  cp -f "$f" "$EV_DST/$base"
  echo "  synced events/$base"
done
if [[ -d "$EV_SRC/messaging/v1" ]]; then
  mkdir -p "$EV_DST/messaging/v1"
  cp -f "$EV_SRC/messaging/v1/"*.proto "$EV_DST/messaging/v1/" 2>/dev/null || true
fi

export PROTO_EVENTS_ROOT="$EV_DST"
export RP_PROTO_EVENTS_MIRROR="$EV_DST"

say "Topic routing unit tests"
run pnpm -C services/common exec vitest run src/outbox/topicRouting.test.ts

say "Kafka topic list (active mirror only)"
# shellcheck source=lib/rp-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/rp-kafka-event-topics-from-proto.sh"
export SUF=""
rp_kafka_event_topics_fill
printf '  topics: %s\n' "${RP_KAFKA_EVENT_TOPICS[*]}"
for t in "${RP_KAFKA_EVENT_TOPICS[@]}"; do
  [[ "$t" == *".booking."* || "$t" == "dev.booking.events" || "$t" == *".social."* ]] && {
    echo "❌ forbidden topic: $t" >&2
    exit 1
  }
done

say "verify-proto-topic-alignment.sh (mirror)"
run env PROTO_EVENTS_ROOT="$EV_DST" RP_SKIP_BOOKING_DB="${RP_SKIP_BOOKING_DB:-1}" RP_SKIP_MESSAGING_LEGACY_PEER="${RP_SKIP_MESSAGING_LEGACY_PEER:-1}" \
  bash "$SCRIPT_DIR/verify-proto-topic-alignment.sh"

bash "$SCRIPT_DIR/assert-rp-shell-output-clean.sh" "$LOG"
ok "sync-rp-proto-contract complete"
