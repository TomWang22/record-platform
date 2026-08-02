#!/usr/bin/env bash
# Deferred until identity canary PASS.
set -euo pipefail
echo "❌ I.kafka_three_broker_acceptance is not authorized until H.kafka_identity_canary PASS" >&2
echo "gate5_v7_authorized_to_create=false" >&2
exit 2
