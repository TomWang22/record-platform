#!/usr/bin/env bash
# Deferred until authorizer enablement + broker-side principal promotion.
set -euo pipefail
echo "❌ H.kafka_identity_canary is not authorized until:" >&2
echo "   - StandardAuthorizer enabled fail-closed" >&2
echo "   - final ACLs applied" >&2
echo "   - principals promoted to BROKER_OBSERVED_AUTHORIZATION_PRINCIPAL" >&2
echo "gate5_v7_authorized_to_create=false" >&2
exit 2
