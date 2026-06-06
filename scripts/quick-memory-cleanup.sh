#!/usr/bin/env bash
set -euo pipefail

# Quick memory cleanup script - safe and fast
# Usage: ./scripts/quick-memory-cleanup.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "🔍 $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

echo "=== Quick Memory Cleanup ==="
echo ""

# 1. Docker system prune (safe)
log "Cleaning Docker (safe)..."
docker system prune -f >/dev/null 2>&1 || true
ok "Docker cleanup done"
echo ""

# 2. Next.js cache
log "Cleaning Next.js caches..."
find . -type d -name ".next" -exec rm -rf {} + 2>/dev/null || true
ok "Next.js caches cleaned"
echo ""

# 3. Old bench logs (keep last 3 days)
log "Cleaning old benchmark logs (keeping last 3 days)..."
find bench_logs/ -type f -mtime +3 -delete 2>/dev/null || true
find bench_logs/ -type d -empty -delete 2>/dev/null || true
ok "Bench logs cleaned"
echo ""

# 4. Summary
log "Final disk usage:"
df -h . | head -2

ok "Quick cleanup complete!"
