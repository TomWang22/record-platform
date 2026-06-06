#!/usr/bin/env bash
# Diagnose why MetalLB webhook has no endpoints: controller pod status, events, logs.
# Run when: webhook endpoint never appears, or pool apply fails with "endpoints metallb-webhook-service not found".
# Usage: ./scripts/diagnose-metallb-controller.sh
# See docs/METALLB_CONTROLLER_DEBUG.md.
set -euo pipefail

echo "=== MetalLB controller diagnostic (webhook has no endpoints → controller pod not Running) ==="
echo ""

echo "--- 1) Pods in metallb-system ---"
kubectl get pods -n metallb-system -o wide 2>&1 || true
echo ""

echo "--- 2) Describe controller pod (events) ---"
kubectl describe pod -n metallb-system -l app=metallb,component=controller 2>&1 || true
echo ""

echo "--- 3) Controller logs ---"
kubectl logs -n metallb-system deployment/controller --tail=100 2>&1 || true
echo ""

echo "--- Done. See docs/METALLB_CONTROLLER_DEBUG.md for k3s version + MetalLB compatibility and fixes."
