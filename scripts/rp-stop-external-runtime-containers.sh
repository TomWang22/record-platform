#!/usr/bin/env bash
# Remove OCH external compose containers (off-campus-housing-tracker-*) so RP owns 5433–5443.
set -euo pipefail

say() { printf '%s\n' "$*"; }

ids="$(docker ps -aq --filter 'name=off-campus-housing-tracker-' 2>/dev/null || true)"
if [[ -z "$ids" ]]; then
  say "✅ no off-campus-housing-tracker-* containers"
  exit 0
fi

say "Removing OCH external containers:"
docker ps -a --filter 'name=off-campus-housing-tracker-' --format '  {{.Names}}' || true
docker rm -f $ids 2>/dev/null || true
say "✅ OCH external containers removed"
