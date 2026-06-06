#!/usr/bin/env bash
# Verify all test suites have proper packet capture and database verification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

say "=== Verifying Packet Capture & Database Verification Across All Test Suites ==="

# Test suites to check
SUITES=(
  "test-microservices-http2-http3.sh:baseline"
  "test-microservices-http2-http3-enhanced.sh:enhanced"
  "enhanced-adversarial-tests.sh:adversarial"
  "rotation-suite.sh:rotation"
  "test-packet-capture-standalone.sh:standalone"
  "test-tls-mtls-comprehensive.sh:tls-mtls"
)

PACKET_CAPTURE_OK=0
PACKET_CAPTURE_MISSING=0
DB_VERIFICATION_OK=0
DB_VERIFICATION_MISSING=0

for suite_info in "${SUITES[@]}"; do
  suite_file="${suite_info%%:*}"
  suite_name="${suite_info##*:}"
  suite_path="$SCRIPT_DIR/$suite_file"
  
  if [[ ! -f "$suite_path" ]]; then
    warn "$suite_name: File not found ($suite_file)"
    continue
  fi
  
  say "Checking $suite_name ($suite_file)"
  
  # Check for packet capture
  if grep -q "lib/packet-capture\|start_capture\|init_capture" "$suite_path"; then
    ok "  Packet capture: Present"
    PACKET_CAPTURE_OK=$((PACKET_CAPTURE_OK + 1))
  else
    warn "  Packet capture: Missing"
    PACKET_CAPTURE_MISSING=$((PACKET_CAPTURE_MISSING + 1))
  fi
  
  # Check for database verification
  if grep -q "Database Verification\|database.*verification\|Post-Test.*Data" "$suite_path"; then
    ok "  Database verification: Present"
    DB_VERIFICATION_OK=$((DB_VERIFICATION_OK + 1))
  else
    warn "  Database verification: Missing"
    DB_VERIFICATION_MISSING=$((DB_VERIFICATION_MISSING + 1))
  fi
done

say "=== Summary ==="
echo "ℹ️  Packet capture: $PACKET_CAPTURE_OK present, $PACKET_CAPTURE_MISSING missing"
echo "ℹ️  Database verification: $DB_VERIFICATION_OK present, $DB_VERIFICATION_MISSING missing"

if [[ $PACKET_CAPTURE_MISSING -gt 0 ]] || [[ $DB_VERIFICATION_MISSING -gt 0 ]]; then
  warn "Some test suites are missing packet capture or database verification"
  exit 1
else
  ok "All test suites have packet capture and database verification"
  exit 0
fi
