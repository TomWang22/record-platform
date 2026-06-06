#!/usr/bin/env bash
# Diagnose k3s crash-loop inside Colima VM (restart counter 200+).
# Run when: kubectl is flaky, MetalLB webhook never ready, or you see "restart counter is at NNN" in systemctl status k3s.
# Usage: ./scripts/colima-diagnose-k3s-crash-loop.sh
# See docs/COLIMA_K3S_CRASH_LOOP.md.
set -euo pipefail

echo "=== k3s crash-loop diagnostic (Colima VM) ==="
echo ""
echo "If k3s is crash-looping, that is the root cause of API flakiness and MetalLB webhook never ready."
echo ""

echo "--- 1) k3s service status (inside VM) ---"
colima ssh -- sudo systemctl status k3s 2>&1 || true
echo ""

echo "--- 2) Last 200 k3s journal lines (truth source for failure) ---"
colima ssh -- sudo journalctl -u k3s -n 200 --no-pager 2>&1 || true
echo ""

echo "--- Done. See docs/COLIMA_K3S_CRASH_LOOP.md for:"
echo "    - Surgical fix: stop k3s, rm -rf /var/lib/rancher/k3s/server/db, start k3s"
echo "    - Nuclear option: colima delete then COLIMA_NETWORK_ADDRESS=1 ./scripts/colima-start-k3s-bridged.sh"
