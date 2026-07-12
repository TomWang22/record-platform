#!/usr/bin/env bash
# Copy api-gateway route coverage JSONL from pod → a host path (OCH Coverage Model v1).
# Requires: kubectl, GATEWAY_ROUTE_COVERAGE_LOG=1 on the deployment.
#
# Remote path inside the api-gateway container: GATEWAY_ROUTE_COVERAGE_POD_FILE (default /tmp/och-routes-hit.jsonl).
# Do not use GATEWAY_ROUTE_COVERAGE_FILE here — the matrix sets that to a host path for Vitest.
#
# Optional arg $1: output file (default bench_logs/routes-hit.jsonl). run-full-matrix-local-report.sh passes a temp file then appends into the Vitest JSONL for the same matrix run.
set -euo pipefail
NS="${HOUSING_NS:-record-platform}"
POD="$(kubectl -n "$NS" get pods -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[[ -n "$POD" ]] || { echo "no api-gateway pod in $NS" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$ROOT/bench_logs/routes-hit.jsonl}"
mkdir -p "$(dirname "$OUT")"
REMOTE="${GATEWAY_ROUTE_COVERAGE_POD_FILE:-/tmp/och-routes-hit.jsonl}"
# kubectl cp can exit 0 even when the remote path is missing (tar error on stderr); verify the artifact.
kubectl -n "$NS" cp "$POD:$REMOTE" "$OUT" || { echo "kubectl cp failed (is route logging enabled?)" >&2; exit 1; }
if [[ ! -f "$OUT" ]]; then
  echo "fetch-gateway-route-hits: copy did not create $OUT (remote missing $REMOTE on $POD? rebuild api-gateway image with route-coverage middleware)" >&2
  exit 1
fi
echo "Wrote $OUT ($(wc -l <"$OUT" | tr -d ' ') lines)"
