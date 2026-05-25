#!/usr/bin/env bash
set -euo pipefail
OBS_NS="${OBS_NS:-observability}"
issues=()
for dep in prometheus grafana jaeger otel-collector; do
  kubectl get deploy "$dep" -n "$OBS_NS" >/dev/null 2>&1 || issues+=("missing deploy $dep in $OBS_NS")
done
[[ ${#issues[@]} -gt 0 ]] && { printf '%s\n' "${issues[@]}" >&2; exit 1; }
echo "✅ observability deployments present in $OBS_NS"
