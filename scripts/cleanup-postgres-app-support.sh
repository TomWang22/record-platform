#!/bin/bash
# Cleanup script for Postgres Application Support folder (27GB)
# REVIEW CAREFULLY - may contain important data

set -e

POSTGRES_DIR="$HOME/Library/Application Support/Postgres"

echo "═══════════════════════════════════════════════════════════"
echo "  Postgres Application Support Cleanup"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Location: $POSTGRES_DIR"
echo "Size: $(du -sh "$POSTGRES_DIR" 2>/dev/null | awk '{print $1}')"
echo ""

if [ ! -d "$POSTGRES_DIR" ]; then
    echo "❌ Postgres Application Support directory not found"
    exit 1
fi

echo "📊 Breakdown:"
du -sh "$POSTGRES_DIR"/* 2>/dev/null | sort -hr | head -15
echo ""

echo "⚠️  WARNING: This directory may contain:"
echo "   • Old Postgres installations"
echo "   • Postgres data directories"
echo "   • Postgres extension files"
echo ""
echo "🔍 Review the breakdown above to identify:"
echo "   1. Old Postgres versions (safe to remove)"
echo "   2. Old data directories (if not needed)"
echo "   3. Extension files (usually safe)"
echo ""
echo "📋 Common cleanup targets:"
echo "   • Old Postgres versions (e.g., 13.x, 14.x if using 16.x)"
echo "   • Unused data directories"
echo "   • Old log files"
echo ""
echo "🔧 To manually review and clean:"
echo "   cd \"$POSTGRES_DIR\""
echo "   du -sh * | sort -hr"
echo ""
echo "⚠️  DO NOT delete if you're unsure - review first!"
