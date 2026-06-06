#!/usr/bin/env bash
# Run all DB load scripts to populate millions of rows across records, auth, social, listings, shopping, analytics, auction_monitor, python_ai.
# Respects each schema; data is realistic (random but real-looking). Use for pgbench and load testing.
#
# Prerequisites:
#   - Docker Compose Postgres instances on ports 5433–5440 (e.g. docker compose up -d)
#   - Migrations applied to each DB (infra/db/*.sql)
#   - Optional: run ./scripts/preflight-load-dbs.sh first to verify Docker, containers, and disk space
#
# Usage:
#   ./scripts/load-all-dbs-millions.sh              # default targets per script
#   TARGET_ROWS=500000 ./scripts/load-all-dbs-millions.sh   # override records target
#   SKIP_RECORDS=1 ./scripts/load-all-dbs-millions.sh      # skip records (already loaded)
#   PGSQL_VIA_DOCKER=1 ./scripts/load-all-dbs-millions.sh  # run psql inside Postgres containers (avoids host psql segfault)
#
# Environment (optional):
#   SKIP_RECORDS, SKIP_AUTH, SKIP_SOCIAL, SKIP_LISTINGS, SKIP_SHOPPING, SKIP_ANALYTICS, SKIP_AUCTION_MONITOR, SKIP_PYTHON_AI — set to 1 to skip that DB
#   TARGET_ROWS, TARGET_POSTS, TARGET_LISTINGS, etc. — passed through to individual scripts
#   PGSQL_VIA_DOCKER=1 — use docker exec to run psql inside the Postgres container (use if host psql segfaults)
#   LOAD_SAFE_FOR_COLIMA=1 — use smaller batches and shorter timeouts to avoid OOM/limits on Colima/K3s (recommended for local)
#   LOAD_MINIMAL=1 — small row targets (tens of thousands) so load finishes in minutes; use for tuning, then drain mock data when done
#   PGSQL_VIA_DOCKER=0 — connect with host psql to localhost:PORT; use when Docker CLI is hung but Postgres is up (e.g. containers already running)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Live timestamp for progress
ts() { printf '%s' "$(date '+%Y-%m-%d %H:%M:%S')"; }

# Colima/K3s friendly: smaller batches and timeouts to stay within memory/CPU limits
if [[ "${LOAD_SAFE_FOR_COLIMA:-0}" == "1" ]]; then
  export BATCH_SIZE="${BATCH_SIZE:-10000}"
  export STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-600}"
  export LISTINGS_BATCH_SIZE="${LISTINGS_BATCH_SIZE:-5000}"
  export SOCIAL_POSTS_BATCH_SIZE="${SOCIAL_POSTS_BATCH_SIZE:-5000}"
  # Use fast staging for listings when table is small enough (avoids ~11 min per 5k rows)
  export LOAD_LISTINGS_FAST_STAGING="${LOAD_LISTINGS_FAST_STAGING:-1}"
  echo "$(ts) LOAD_SAFE_FOR_COLIMA=1: using BATCH_SIZE=${BATCH_SIZE} STATEMENT_TIMEOUT=${STATEMENT_TIMEOUT} LISTINGS_FAST_STAGING=${LOAD_LISTINGS_FAST_STAGING} (limits for Colima/K3s)"
  echo ""
fi

# Minimal/fast load: small targets so run finishes in minutes. Use for tuning; drain mock data when done.
if [[ "${LOAD_MINIMAL:-0}" == "1" ]]; then
  export TARGET_ROWS="${TARGET_ROWS:-50000}"
  export TARGET_POSTS="${TARGET_POSTS:-20000}"
  export TARGET_COMMENTS="${TARGET_COMMENTS:-20000}"
  export TARGET_GROUPS="${TARGET_GROUPS:-5000}"
  export TARGET_MESSAGES="${TARGET_MESSAGES:-20000}"
  export TARGET_LISTINGS="${TARGET_LISTINGS:-20000}"
  export TARGET_VIEWS="${TARGET_VIEWS:-30000}"
  export TARGET_CART="${TARGET_CART:-10000}"
  export TARGET_WATCHLIST="${TARGET_WATCHLIST:-10000}"
  export TARGET_RECENTLY_VIEWED="${TARGET_RECENTLY_VIEWED:-10000}"
  export TARGET_WISHLIST="${TARGET_WISHLIST:-10000}"
  export TARGET_PURCHASE_HISTORY="${TARGET_PURCHASE_HISTORY:-20000}"
  export TARGET_SEARCH_HISTORY="${TARGET_SEARCH_HISTORY:-20000}"
  export TARGET_PRICE_SNAPSHOTS="${TARGET_PRICE_SNAPSHOTS:-20000}"
  export TARGET_SEARCH_ANALYTICS="${TARGET_SEARCH_ANALYTICS:-30000}"
  export TARGET_USER_BEHAVIOR="${TARGET_USER_BEHAVIOR:-20000}"
  export TARGET_TREND_SNAPSHOTS="${TARGET_TREND_SNAPSHOTS:-10000}"
  export TARGET_AUCTION_RESULTS="${TARGET_AUCTION_RESULTS:-20000}"
  export TARGET_USER_SAVED="${TARGET_USER_SAVED:-5000}"
  export TARGET_MONITORING_JOBS="${TARGET_MONITORING_JOBS:-5000}"
  export TARGET_MODELS="${TARGET_MODELS:-20}"
  export TARGET_PREDICTIONS="${TARGET_PREDICTIONS:-20000}"
  export TARGET_TRAINING_DATA="${TARGET_TRAINING_DATA:-20000}"
  export TARGET_EMBEDDINGS="${TARGET_EMBEDDINGS:-20000}"
  echo "$(ts) LOAD_MINIMAL=1: small targets for fast load (tune, then drain mock data when done)"
  echo ""
fi

echo "$(ts) === Load all DBs with millions of rows (realistic data, schema-respecting) ==="
echo ""

run_if() {
  local skip_var="$1"
  local label="$2"
  local script="$3"
  if [[ "${!skip_var:-0}" == "1" ]]; then
    echo "$(ts) [SKIP] $label (${skip_var}=1)"
    return 0
  fi
  if [[ ! -f "$script" ]]; then
    echo "$(ts) [SKIP] $label (script not found: $script)"
    return 0
  fi
  echo "$(ts) --- $label ---"
  # Run with bash explicitly (avoid shebang/exec issues); pass env through
  bash "$script" || {
    local r=$?
    echo "$(ts) Failed: $script (exit $r)" >&2
    if [[ $r -eq 139 ]] || [[ $r -eq 134 ]]; then
      echo "$(ts) Hint: segfault/signal from psql. Try: PGSQL_VIA_DOCKER=1 ./scripts/load-all-dbs-millions.sh" >&2
    fi
    return 1
  }
  echo ""
}

# Order: records first (other services may reference or assume it), then auth, social, listings, shopping, analytics, auction_monitor, python_ai
run_if SKIP_RECORDS "Records (port 5433)" "./scripts/load-records-millions.sh"
run_if SKIP_AUTH "Auth (port 5437)" "./scripts/load-auth-millions.sh"
run_if SKIP_SOCIAL "Social (port 5434)" "./scripts/load-social-millions.sh"
run_if SKIP_LISTINGS "Listings (port 5435)" "./scripts/load-listings-millions.sh"
run_if SKIP_SHOPPING "Shopping (port 5436)" "./scripts/load-shopping-millions.sh"
run_if SKIP_ANALYTICS "Analytics (port 5439)" "./scripts/load-analytics-millions.sh"
run_if SKIP_AUCTION_MONITOR "Auction monitor (port 5438)" "./scripts/load-auction-monitor-millions.sh"
run_if SKIP_PYTHON_AI "Python AI (port 5440)" "./scripts/load-python-ai-millions.sh"

echo "$(ts) === All loaders finished ==="
echo "$(ts) Next: run pgbench sweeps (e.g. run_pgbench_sweep.sh, run_social_pgbench_sweep.sh, ...) or run-preflight-scale-and-all-suites.sh with RUN_PGBENCH=1."
