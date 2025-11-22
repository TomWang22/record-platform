#!/usr/bin/env bash
set -euo pipefail

# Clean up old WAL archive files to free disk space
# Keeps the most recent N files (default: 100)

NS="${NS:-record-platform}"
KEEP_FILES="${KEEP_FILES:-100}"

POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -z "$POD" ]]; then
  echo "❌ PostgreSQL pod not found in namespace $NS" >&2
  exit 1
fi

echo "=== Cleaning up WAL archive ==="
echo "Pod: $POD"
echo "Keeping most recent $KEEP_FILES files"

# Check current size
BEFORE=$(kubectl -n "$NS" exec "$POD" -c db -- bash -c 'du -sh /wal-archive 2>/dev/null | cut -f1' || echo "unknown")
echo "Before: $BEFORE"

# Clean up old files (keep most recent N)
kubectl -n "$NS" exec "$POD" -c db -- bash -c "
  cd /wal-archive
  COUNT=\$(ls -1 [0-9]* 2>/dev/null | wc -l)
  if [[ \$COUNT -gt $KEEP_FILES ]]; then
    ls -t [0-9]* 2>/dev/null | tail -n +\$((KEEP_FILES + 1)) | xargs -r rm -f
    echo \"✅ Removed \$((COUNT - $KEEP_FILES)) old WAL files\"
  else
    echo \"✅ Only \$COUNT files (keeping all)\"
  fi
"

# Check new size
AFTER=$(kubectl -n "$NS" exec "$POD" -c db -- bash -c 'du -sh /wal-archive 2>/dev/null | cut -f1' || echo "unknown")
REMAINING=$(kubectl -n "$NS" exec "$POD" -c db -- bash -c 'ls -1 /wal-archive/[0-9]* 2>/dev/null | wc -l' || echo "0")

echo "After: $AFTER"
echo "Remaining files: $REMAINING"

# Check disk space
echo ""
echo "=== Disk space ==="
kubectl -n "$NS" exec "$POD" -c db -- df -h | grep -E "Filesystem|overlay|/pgdata|/wal-archive"

