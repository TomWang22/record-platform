#!/usr/bin/env bash
set -Eeuo pipefail

# Clean up duplicate databases created during restore
# Removes 'records' database from containers that shouldn't have it

echo "=== Cleaning Up Duplicate Databases ==="
echo ""
echo "This script will remove the 'records' database from containers"
echo "that shouldn't have it (caused by pg_dumpall restoring all databases)."
echo ""

# Containers that should NOT have 'records' database
CONTAINERS_TO_CLEAN=(
    "record-platform-postgres-auth-1"
    "record-platform-postgres-social-1"
    "record-platform-postgres-listings-1"
    "record-platform-postgres-shopping-1"
    "record-platform-postgres-analytics-1"
)

echo "Checking which containers have 'records' database..."
for container in "${CONTAINERS_TO_CLEAN[@]}"; do
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='records';" 2>/dev/null | grep -q 1; then
        echo "  ⚠️  $container has 'records' database (will remove)"
    else
        echo "  ✅ $container does not have 'records' database"
    fi
done

echo ""
read -p "Continue with cleanup? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "Removing 'records' database from containers..."

for container in "${CONTAINERS_TO_CLEAN[@]}"; do
    echo ""
    echo "=== Cleaning $container ==="
    
    # Check if records database exists
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='records';" 2>/dev/null | grep -q 1; then
        echo "  Removing 'records' database..."
        
        # Terminate all connections to the database
        colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = 'records' AND pid <> pg_backend_pid();
        " 2>&1 || true
        
        # Drop the database
        if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS records;" 2>&1; then
            echo "  ✅ Removed 'records' database from $container"
        else
            echo "  ❌ Failed to remove 'records' database from $container"
        fi
    else
        echo "  ✅ $container does not have 'records' database (skipping)"
    fi
done

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "Verifying cleanup..."

for container in "${CONTAINERS_TO_CLEAN[@]}"; do
    if colima ssh -- sudo nerdctl exec "$container" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='records';" 2>/dev/null | grep -q 1; then
        echo "  ❌ $container still has 'records' database"
    else
        echo "  ✅ $container cleaned (no 'records' database)"
    fi
done

echo ""
echo "✅ Cleanup complete!"
