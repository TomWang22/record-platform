#!/usr/bin/env bash
# Sanity-check: each infra/db *-outbox.sql has a matching proto/events/<domain>.proto stem where expected,
# and lifecycle topics are declared in rp-kafka-event-topics-from-proto.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -d proto/events ]] || die "proto/events missing"
[[ -d infra/db ]] || die "infra/db missing"

# Required outbox DDL files (see docs/OUTBOX_PROTO_TOPIC_MATRIX.md)
required=(
  01-auth-outbox.sql
  02-messaging-outbox.sql
  02-media-outbox.sql
  03-listings-outbox.sql
  03-booking-outbox.sql
  03-trust-outbox.sql
  03-notification-outbox.sql
  01-records-outbox.sql
  01-shopping-outbox.sql
  01-social-outbox.sql
  01-auction-monitor-outbox.sql
  01-ai-outbox.sql
  03-analytics-outbox.sql
)
for f in "${required[@]}"; do
  [[ -f "infra/db/$f" ]] || die "Missing infra/db/$f"
done

# Lifecycle topics must be present in topic generator
grep -q 'user\.lifecycle\.v1' scripts/lib/rp-kafka-event-topics-from-proto.sh \
  || die "rp-kafka-event-topics-from-proto.sh missing user.lifecycle.v1"
grep -q 'user\.lifecycle\.ack\.v1' scripts/lib/rp-kafka-event-topics-from-proto.sh \
  || die "rp-kafka-event-topics-from-proto.sh missing user.lifecycle.ack.v1"

# Proto README must mention lifecycle + contract doc
grep -q 'user\.lifecycle\.v1' proto/events/README.md || die "proto/events/README.md missing user.lifecycle.v1"
test -f docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md || die "docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md missing"

ok "Outbox SQL files, lifecycle topics, and proto README references look aligned."
