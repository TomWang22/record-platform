#!/usr/bin/env bash
# Wrapper for BOOT-MTLS-1 gate (implementation in lib/).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/lib/rp-bootstrap-grpc-mtls-gate.sh" "$@"
