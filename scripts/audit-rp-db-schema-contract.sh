#!/usr/bin/env bash
# Assert RP runtime DB schema contract on host Postgres (5433–5443).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-post-restore-schema-contract.sh
source "$SCRIPT_DIR/lib/rp-post-restore-schema-contract.sh"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "audit-rp-db-schema-contract (host=$PGHOST)"
if ! rp_post_restore_assert_schema_tables; then
  echo "❌ RP DB schema contract FAILED" >&2
  exit 1
fi
echo "✅ RP DB schema contract OK"
