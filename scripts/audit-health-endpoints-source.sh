#!/usr/bin/env bash
# Verify Node services expose /healthz (and /readyz where required).
# mountRpHttpHealth (@common/utils) implements /healthz + /readyz in services/common.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
issues=()
# HTTP + gRPC runtime services: readiness must include deps + local mTLS gRPC (/readyz).
READYZ_SERVICES=(
  auth-service records-service listings-service shopping-service messaging-service
  notification-service trust-service analytics-service media-service python-ai-service
  auction-monitor api-gateway
)
for svc in auth-service records-service listings-service shopping-service messaging-service notification-service trust-service analytics-service media-service python-ai-service auction-monitor api-gateway; do
  dir="$REPO_ROOT/services/$svc/src"
  [[ -d "$dir" ]] || continue
  grep -rqE 'healthz|mountRpHttpHealth' "$dir" || issues+=("$svc: no /healthz (or mountRpHttpHealth) in src")
  for rz in "${READYZ_SERVICES[@]}"; do
    [[ "$svc" == "$rz" ]] || continue
    grep -rqE 'readyz|mountRpHttpHealth' "$dir" || issues+=("$svc: missing /readyz (or mountRpHttpHealth)")
    break
  done
done
[[ ${#issues[@]} -gt 0 ]] && { printf '%s\n' "${issues[@]}" >&2; exit 1; }
echo "✅ health endpoint source audit passed"
