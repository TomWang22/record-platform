#!/usr/bin/env bash
# Audit RP proto/events contracts before bootstrap. Exit non-zero on active booking/social paths.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-proto-env.sh
source "$SCRIPT_DIR/lib/rp-proto-env.sh"
rp_apply_proto_skip_env
export REPO_ROOT

FAIL=0
fail() { echo "❌ $*"; FAIL=1; }
pass() { echo "PASS: $*"; }

ACTIVE_SERVICES=(
  auth-service records-service listings-service shopping-service
  messaging-service media-service notification-service trust-service
  analytics-service python-ai-service api-gateway event-layer-verification
)

say() { printf '\n=== %s ===\n' "$*"; }

say "Service protos present"
for svc in "${ACTIVE_SERVICES[@]}"; do
  case "$svc" in
    api-gateway|event-layer-verification) continue ;;
    python-ai-service) f="python-ai.proto" ;;
    *) f="${svc%-service}.proto" ;;
  esac
  [[ -f "$REPO_ROOT/proto/$f" ]] || fail "missing proto/$f for $svc"
done
pass "core proto files"

say "proto/events for active domains"
for stem in auth records listing shopping messaging media notification trust analytics ai auction_monitor envelope; do
  [[ -f "$REPO_ROOT/proto/events/${stem}.proto" ]] || fail "missing proto/events/${stem}.proto"
done
pass "event protos"

say "k8s proto mirror"
for stem in auth records listing shopping messaging media notification trust analytics; do
  [[ -f "$REPO_ROOT/infra/k8s/base/config/proto/events/${stem}.proto" ]] || fail "missing k8s mirror events/${stem}.proto"
done
if [[ -f "$REPO_ROOT/infra/k8s/base/config/proto/events/booking.proto" ]] || \
   [[ -f "$REPO_ROOT/infra/k8s/base/config/proto/events/social.proto" ]]; then
  fail "booking/social still mirrored under infra/k8s/base/config/proto/events (run sync-rp-proto-contract.sh)"
else
  pass "no booking/social in k8s events mirror"
fi

say "Active k8s deploys must not include booking/social"
for bad in reservation-mesh messaging-service; do
  if find "$REPO_ROOT/infra/k8s/base" -path "*/${bad}/deploy.yaml" 2>/dev/null | grep -q .; then
    fail "deploy manifest exists: $bad"
  fi
done
pass "no booking/social k8s deploy dirs"

say "api-gateway must not register social/booking HTTP routes"
if grep -E "/social\.|booking\." "$REPO_ROOT/services/api-gateway/src/server.ts" 2>/dev/null | \
   grep -vE 'RP_SKIP|removed|skip|//'; then
  fail "api-gateway still references social/booking routes"
else
  pass "api-gateway clean"
fi

say "topicRouting must not map booking as canonical path"
if grep -q 'booking\.created' "$REPO_ROOT/services/common/src/outbox/topicRouting.ts" 2>/dev/null; then
  fail "topicRouting.ts contains booking route"
else
  pass "topicRouting no booking"
fi

say "Record listing event shape"
if ! grep -q 'RecordListingCreatedV1' "$REPO_ROOT/proto/events/listing.proto"; then
  fail "missing RecordListingCreatedV1"
elif ! grep -q 'seller_city' "$REPO_ROOT/proto/events/listing.proto"; then
  fail "RecordListingCreatedV1 missing seller_city/seller_region"
else
  pass "RecordListingCreatedV1 present with public location fields"
fi

say "Kafka topic derivation (RP_SKIP_BOOKING)"
export PROTO_EVENTS_ROOT="$REPO_ROOT/infra/k8s/base/config/proto/events"
export RP_PROTO_EVENTS_MIRROR="$PROTO_EVENTS_ROOT"
# shellcheck source=scripts/lib/rp-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/rp-kafka-event-topics-from-proto.sh"
export ENV_PREFIX=dev SUF=""
rp_kafka_event_topics_fill || fail "rp_kafka_event_topics_fill"
for t in "${RP_KAFKA_EVENT_TOPICS[@]}"; do
  [[ "$t" == *".booking."* ]] && fail "booking topic in list: $t"
  [[ "$t" == *".social."* ]] && fail "social topic in list: $t"
done
pass "kafka topics exclude booking/social"

say "event-layer-verification"
if grep -qE 'dev\.booking\.events|booking\.created' \
  "$REPO_ROOT/services/event-layer-verification/src/"*.ts 2>/dev/null; then
  fail "event-layer-verification still uses booking fixtures"
else
  pass "event-layer uses RP topics only"
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo ""
  echo "=== Proto contract audit PASSED ==="
  exit 0
fi
echo ""
echo "=== Proto contract audit FAILED ==="
exit 1
