#!/usr/bin/env bash
# Remove RP external compose containers (record-platform-*) so RP owns 5433–5443.
set -euo pipefail

say() { printf '%s\n' "$*"; }

ids="$(docker ps -aq --filter 'name=record-platform-' 2>/dev/null || true)"
if [[ -z "$ids" ]]; then
  say "✅ no record-platform-* containers"
  exit 0
fi

say "Removing RP external containers:"
docker ps -a --filter 'name=record-platform-' --format '  {{.Names}}' || true
docker rm -f $ids 2>/dev/null || true
say "✅ RP external containers removed"
