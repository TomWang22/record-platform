#!/usr/bin/env bash
# Ensure gRPC health is reachable for services with grpcPort (probe-first; logs are secondary).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"

NS="${HOUSING_NS:-record-platform}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }

_arch_probe() {
  local arch
  arch="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || echo amd64)"
  case "$arch" in
    arm64|aarch64) echo "$REPO_ROOT/scripts/vendor/grpc_health_probe-linux-arm64" ;;
    *) echo "$REPO_ROOT/scripts/vendor/grpc_health_probe-linux-amd64" ;;
  esac
}

PROBE_BIN="$(_arch_probe)"

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  json="$(rp_runtime_health_service_json "$svc" 2>/dev/null || true)"
  [[ -n "$json" ]] || continue
  grpc_port="$(jq -r '.grpcPort // empty' <<<"$json")"
  grpc_name="$(jq -r '.grpcService // empty' <<<"$json")"
  grpc_req="$(jq -r '.grpcRequiredForRuntime // false' <<<"$json")"
  tls_policy="$(jq -r '.tlsPolicy // "plaintext"' <<<"$json")"
  sname="$(jq -r '.grpcTlsServerName // .k8sName // empty' <<<"$json")"
  [[ -n "$grpc_port" && "$grpc_port" != "null" ]] || continue
  dep="$(jq -r '.k8sName // .deployment // empty' <<<"$json")"
  [[ -n "$dep" ]] || dep="$svc"

  if [[ -z "$grpc_name" ]]; then
    if [[ "$grpc_req" == "true" ]]; then
      bad "$svc: grpcPort set but grpcService missing in contract (required for runtime)"
    else
      warn "$svc: grpcPort set, grpcService empty — skipping log/probe audit (not runtime-required)"
    fi
    continue
  fi

  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    echo "ℹ️  skip $dep (not deployed)"
    continue
  fi

  container="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || echo app)"
  addr="localhost:${grpc_port}"
  probe_ok=0
  if [[ "$tls_policy" == "service-mtls" ]]; then
    if kubectl -n "$NS" exec "deploy/$dep" -c "$container" -- sh -ec "
      command -v /usr/local/bin/grpc-health-probe >/dev/null 2>&1 || exit 127
      /usr/local/bin/grpc-health-probe -addr=$addr -service='$grpc_name' -tls -tls-no-verify=false \
        -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key \
        -tls-server-name=$sname -connect-timeout=3s -rpc-timeout=12s
    " >/dev/null 2>&1; then
      probe_ok=1
    fi
  elif kubectl -n "$NS" exec "deploy/$dep" -c "$container" -- sh -ec "
    command -v /usr/local/bin/grpc-health-probe >/dev/null 2>&1 || exit 127
    /usr/local/bin/grpc-health-probe -addr=$addr -service='$grpc_name' -connect-timeout=3s -rpc-timeout=12s
  " >/dev/null 2>&1; then
    probe_ok=1
  fi

  if [[ "$probe_ok" -eq 1 ]]; then
    ok "$dep in-pod grpc-health SERVING ($grpc_name)"
    continue
  fi

  logs="$(kubectl logs -n "$NS" "deploy/$dep" --tail=200 -c "$container" 2>/dev/null || kubectl logs -n "$NS" "deploy/$dep" --tail=200 2>/dev/null || true)"
  if echo "$logs" | grep -qF "$grpc_name"; then
    ok "$dep logs mention $grpc_name (probe unavailable)"
  elif echo "$logs" | grep -qi 'Health Check registered'; then
    ok "$dep has grpc-health registration in logs (probe unavailable)"
  elif [[ "$grpc_req" == "true" ]]; then
    bad "$dep: grpc-health-probe failed and no log registration for $grpc_name"
  else
    warn "$dep: grpc-health-probe failed (not runtime-required)"
  fi
done < <(python3 -c '
import json,sys
with open(sys.argv[1]) as f: d=json.load(f)
for k,v in (d.get("services") or {}).items():
    if v.get("grpcPort"): print(k)
' "$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json")

[[ "$FAIL" -eq 0 ]] && { echo "✅ audit-rp-grpc-health-source passed"; exit 0; }
exit 1
