#!/usr/bin/env bash
# Sync protos to k8s config tree and apply proto-files + app-config (namespace record-platform).
# ConfigMap keys cannot contain '/'; nested proto/events/* use '__' in keys (see services/common proto.ts).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-${RECORD_PLATFORM_NS:-record-platform}}"
PROTO_DIR="$REPO_ROOT/infra/k8s/base/config/proto"
cd "$REPO_ROOT"

bash "$SCRIPT_DIR/sync-proto-to-k8s.sh"

_tmpdir="$(mktemp -d)"
trap 'rm -rf "$_tmpdir"' EXIT
_proto_args=()

while IFS= read -r -d '' f; do
  rel="${f#"$PROTO_DIR"/}"
  key="${rel//\//__}"
  _proto_args+=(--from-file="${key}=${f}")
done < <(find "$PROTO_DIR" -type f -name '*.proto' -print0)

[[ ${#_proto_args[@]} -gt 0 ]] || { echo "❌ no .proto files under $PROTO_DIR" >&2; exit 1; }

kubectl create configmap proto-files -n "$NS" "${_proto_args[@]}" \
  --dry-run=client -o yaml >"$_tmpdir/proto-files.yaml"
kubectl apply -f "$_tmpdir/proto-files.yaml" --request-timeout=120s

kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" -n "$NS" --request-timeout=120s
kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-secrets.yaml" -n "$NS" --request-timeout=120s 2>/dev/null || true

echo "✅ proto-files ConfigMap (${#_proto_args[@]} protos, events/* as events__*) + app-config applied (ns=$NS)"
