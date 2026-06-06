#!/usr/bin/env bash
# Wrapper: backup all Record Platform Postgres DBs (11 on ports 5433–5443).
#
# Usage: same as backup-rp-postgres-dbs.sh
#   PGPASSWORD=postgres ./scripts/backup-all-dbs.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/backup-rp-postgres-dbs.sh" "$@"
