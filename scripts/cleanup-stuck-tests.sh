#!/usr/bin/env bash
# Cleanup script for stuck k6 tests
# Run this in a NEW terminal if the test is stuck

echo "=== Cleaning Up Stuck Test Processes ==="
echo ""

echo "Killing k6 processes..."
pkill -f "k6 run" 2>/dev/null || echo "  No k6 processes found"
pkill -f "run-k6-tests-simple" 2>/dev/null || echo "  No test script processes found"
pkill -f "run-k6-with-comprehensive" 2>/dev/null || echo "  No comprehensive test processes found"

echo ""
echo "Killing monitoring processes..."
pkill -f "kubectl.*exec.*tcpdump" 2>/dev/null || echo "  No tcpdump processes found"
pkill -f "kubectl.*exec.*strace" 2>/dev/null || echo "  No strace processes found"
pkill -f "kubectl.*top" 2>/dev/null || echo "  No kubectl top processes found"

echo ""
echo "Waiting 2 seconds..."
sleep 2

echo ""
echo "Checking for remaining processes..."
ps aux | grep -E "k6|run-k6" | grep -v grep || echo "  No k6-related processes found"

echo ""
echo "✅ Cleanup complete"
echo ""
echo "You can now run the test again with:"
echo "  ./scripts/run-k6-tests-fixed.sh"

