#!/usr/bin/env bash
# Sync repo proto/ → infra/k8s/base/config/proto for the proto-files ConfigMap.
# Required before kubectl kustomize (grpc-clients.ts loads records/social/shopping/etc. at import).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/proto"
DST="$ROOT/infra/k8s/base/config/proto"
EVENTS_DST="$DST/events/messaging/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/rp-proto-env.sh
source "$SCRIPT_DIR/lib/rp-proto-env.sh"
rp_apply_proto_skip_env

mkdir -p "$DST" "$EVENTS_DST" "$DST/events"

_sync() {
  local rel="$1"
  if [[ -f "$SRC/$rel" ]]; then
    mkdir -p "$DST/$(dirname "$rel")"
    cp -f "$SRC/$rel" "$DST/$rel"
    echo "  synced $rel"
  else
    echo "  ⚠️  missing $SRC/$rel" >&2
    return 1
  fi
}

_sync_optional() {
  local rel="$1"
  if [[ -f "$SRC/$rel" ]]; then
    _sync "$rel"
  else
    rm -f "$DST/$rel" 2>/dev/null || true
    echo "  skipped $rel (not in repo)"
  fi
}

FAIL=0
for f in \
  common.proto health.proto auth.proto records.proto listings.proto shopping.proto \
  messaging.proto media.proto notification.proto trust.proto analytics.proto \
  auction-monitor.proto python-ai.proto; do
  _sync "$f" || FAIL=1
done
_sync_optional social.proto
if [[ "${RP_SKIP_BOOKING_SERVICE}" != "1" ]] && [[ -f "$SRC/booking.proto" ]]; then
  _sync booking.proto || FAIL=1
else
  rm -f "$DST/booking.proto" 2>/dev/null || true
  echo "  skipped booking.proto (Record Platform — no booking service)"
fi

for f in \
  events/envelope.proto events/auth.proto events/listing.proto events/messaging.proto \
  events/media.proto events/records.proto events/shopping.proto events/notification.proto \
  events/trust.proto events/analytics.proto events/messaging/v1/messaging_events.proto; do
  _sync "$f" || FAIL=1
done

[[ "$FAIL" -eq 0 ]] || {
  echo "❌ proto sync incomplete — fix missing files under $SRC" >&2
  exit 1
}
echo "✅ Proto files synced to infra/k8s/base/config/proto"
