#!/usr/bin/env bash
# Fast load with small row targets so the full run finishes in minutes. Use for tuning; drain mock data when done.
#
# When Docker/Colima is hung (docker ps never returns), run with host psql so we never call Docker:
#   PGSQL_VIA_DOCKER=0 ./scripts/load-all-dbs-minimal.sh
# Ensure Postgres is listening on localhost:5433–5440 (e.g. start containers first: docker compose up -d in another terminal and wait for ports, or run Postgres on host).
#
# When Docker works:
#   PGSQL_VIA_DOCKER=1 LOAD_SAFE_FOR_COLIMA=1 ./scripts/load-all-dbs-minimal.sh
#
# Optional: skip DBs you don't need (same as load-all-dbs-millions.sh):
#   SKIP_RECORDS=1 SKIP_AUTH=1 ... PGSQL_VIA_DOCKER=0 ./scripts/load-all-dbs-minimal.sh
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export LOAD_MINIMAL=1
exec bash "$REPO_ROOT/scripts/load-all-dbs-millions.sh" "$@"
