#!/usr/bin/env bash
# Materialize and integrity-check the canonical HTTP/3 PCAP fixture.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PCAP_DIR="bench_logs/security-contract/pcap"
MANIFEST="$PCAP_DIR/SHA256SUMS"

echo "Tracked PCAP files:"
git ls-files "$PCAP_DIR/**" || true

echo "LFS PCAP files:"
git lfs ls-files "$PCAP_DIR" 2>/dev/null || true

echo "Materialized captures:"
find "$PCAP_DIR" -maxdepth 1 -type f -ls 2>/dev/null || true

PCAP="$(
  find "$PCAP_DIR" -maxdepth 1 -type f \( -name 'vm-*.pcap' -o -name 'vm-*.pcapng' \) | sort | head -1
)"

if [[ -z "$PCAP" || ! -s "$PCAP" ]]; then
  echo "BLOCKED: canonical vm-*.pcap fixture missing under $PCAP_DIR" >&2
  exit 2
fi

if head -1 "$PCAP" | grep -q '^version https://git-lfs.github.com/spec/v1'; then
  echo "BLOCKED: PCAP is an unmaterialized Git LFS pointer: $PCAP" >&2
  exit 2
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "BLOCKED: missing checksum manifest $MANIFEST" >&2
  exit 2
fi

(
  cd "$PCAP_DIR"
  shasum -a 256 -c SHA256SUMS
)

if ! command -v tshark >/dev/null 2>&1; then
  echo "tshark not found; skipping live PCAP parse (checksum gate passed)" >&2
  exit 0
fi

out="$(python3 scripts/lib/transport_validator.py "$PCAP" 2>&1)"
echo "$out"
echo "$out" | grep -q '"valid": true'

echo "verify-transport-pcap-fixture: PASS ($PCAP)"
