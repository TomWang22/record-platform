#!/usr/bin/env bash
# Regression: cold-bootstrap kafka gate must not use plaintext kafka-topics --list on :9093.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/rp-cold-bootstrap-gates.sh"
FAIL=0

if grep -q 'verify-kafka-required-topics-k8s.sh' "$GATE"; then
  echo "✅ gate_kafka delegates to verify-kafka-required-topics-k8s.sh"
else
  echo "❌ gate_kafka must call verify-kafka-required-topics-k8s.sh" >&2
  FAIL=1
fi

if grep -qE 'kafka-topics.*--list' "$GATE" && grep -q 'command-config' "$GATE"; then
  echo "✅ forbidden-topic scan uses SSL command-config"
elif ! grep -qE 'kafka-topics.*--list' "$GATE"; then
  echo "✅ no plaintext kafka-topics --list in gate"
else
  echo "❌ gate must not list topics without --command-config on KRaft :9093" >&2
  FAIL=1
fi

if grep -qE 'kafka-0 -c kafka.*--list|kafka-topics --bootstrap-server kafka-0\.kafka:9093 --list' "$GATE"; then
  echo "❌ gate still uses broken plaintext kafka-topics --list" >&2
  FAIL=1
else
  echo "✅ no plaintext kafka-0.kafka:9093 --list pattern"
fi

[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ test-rp-kafka-gate-ssl passed"
