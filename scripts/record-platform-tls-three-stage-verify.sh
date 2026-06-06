#!/usr/bin/env bash
# Wrapper — canonical path lives under scripts/tls/ (repo root relative).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tls/record-platform-tls-three-stage-verify.sh" "$@"
