#!/usr/bin/env bash
# Legacy shim — use scripts/lib/rp-kafka-event-topics-from-proto.sh
# shellcheck source=rp-kafka-event-topics-from-proto.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rp-kafka-event-topics-from-proto.sh"
