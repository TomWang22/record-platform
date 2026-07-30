#!/usr/bin/env bash
# Legacy RP/housing backup (ports 5441–5448) — not used for Record Platform runtime.
#
# Use: PGPASSWORD=postgres ./scripts/backup-rp-postgres-dbs.sh

echo "❌ backup-all-8-dbs.sh is RP/housing legacy (ports 5441–5448)." >&2
echo "   Use: PGPASSWORD=postgres ./scripts/backup-rp-postgres-dbs.sh" >&2
exit 1
