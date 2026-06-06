#!/usr/bin/env bash
# Remove FRR BGP deployment from MetalLB namespace. Use when FRR fails (ImagePullBackOff)
# or to revert to L2-only mode. MetalLB verify continues to work without FRR.
# Use: ./scripts/remove-metallb-frr.sh
set -euo pipefail

NS="${NS_METALLB:-metallb-system}"
kubectl -n "$NS" delete deploy frr --ignore-not-found 2>/dev/null || true
kubectl -n "$NS" delete svc frr --ignore-not-found 2>/dev/null || true
kubectl -n "$NS" delete configmap frr-config --ignore-not-found 2>/dev/null || true
kubectl -n "$NS" delete bgppeer record-platform-frr --ignore-not-found 2>/dev/null || true
echo "✅ FRR removed. Run ./scripts/verify-metallb-and-traffic-policy.sh (L2 mode)."
