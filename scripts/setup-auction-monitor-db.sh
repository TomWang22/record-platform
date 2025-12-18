#!/usr/bin/env bash
set -euo pipefail

# Setup auction-monitor database schema
# This script sets up the auction_monitor schema and tables in the Docker Postgres instance

# Get the container name (may vary)
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "postgres.*auction|auction.*postgres" | head -1)

if [[ -z "$CONTAINER" ]]; then
  echo "❌ Could not find auction-monitor postgres container"
  echo "Available containers:"
  docker ps --format "{{.Names}}" | grep postgres
  exit 1
fi

echo "✅ Found container: $CONTAINER"

# Apply schema
echo "📝 Applying auction-monitor schema..."
docker exec -i "$CONTAINER" psql -U postgres -d auction_monitor < infra/db/07-auction-monitor-schema.sql

echo "✅ Auction-monitor schema applied!"

# Verify
echo "🔍 Verifying schema..."
docker exec "$CONTAINER" psql -U postgres -d auction_monitor -c "\dt auction_monitor.*"

echo ""
echo "✅ Done! Auction-monitor database is ready."
