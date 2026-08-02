#!/usr/bin/env bash
# Gated acceptance node — not part of default cold-bootstrap.
set -euo pipefail
if [[ "${RP_GATE5_V7_ACCEPTANCE:-0}" != "1" ]]; then
  echo "status=DEFERRED_NOT_AUTHORIZED"
  echo "reason=RP_GATE5_V7_ACCEPTANCE!=1"
  exit 3
fi
echo "❌ I.kafka_three_broker_acceptance not authorized until H.kafka_identity_canary PASS" >&2
echo "gate5_v7_authorized_to_create=false" >&2
exit 2
