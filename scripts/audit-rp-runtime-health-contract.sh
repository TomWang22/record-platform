#!/usr/bin/env bash
# Audit runtime health contract — static (JSON only) or live (K8s Services/endpoints).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/rp-runtime-health-contract.sh
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"

MODE="${RP_RUNTIME_HEALTH_AUDIT_MODE:-static}"
NS="${RP_K8S_NS:-record-platform}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [--mode static|live]

  static  Validate infra/contracts/rp-service-runtime-contract.json only (default).
  live    Require deployed K8s Services, ports, and endpoints.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  static|live) ;;
  *)
    echo "Invalid --mode: $MODE (expected static or live)" >&2
    exit 2
    ;;
esac

echo "audit-rp-runtime-health-contract --mode ${MODE}"

_contract_path="$(rp_runtime_health_contract_path)"
[[ -f "$_contract_path" ]] || bad "missing contract: $_contract_path"

python3 - "$_contract_path" <<'PY' || FAIL=1
import json, re, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as fh:
    doc = json.load(fh)
services = doc.get("services") or {}
legacy = re.compile(r"record-platform", re.I)
text = open(path, encoding="utf-8").read()
if legacy.search(text):
    print("❌ contract contains legacy RP/service names", file=sys.stderr)
    sys.exit(1)
deploys = [
    "auth-service", "records-service", "listings-service", "shopping-service",
    "messaging-service", "trust-service", "analytics-service", "media-service",
    "notification-service", "api-gateway", "python-ai-service", "auction-monitor",
]
allowed_modes = {"http", "grpc", "both"}
allowed_tls = {"plaintext", "service-mtls", "edge-mtls"}
fail = 0
for svc in deploys:
    if svc in ("messaging-service", "reservation-mesh"):
        print(f"❌ {svc} must not be in runtime deploy list", file=sys.stderr)
        fail = 1
        continue
    entry = services.get(svc)
    if not entry:
        print(f"❌ missing runtime health config for {svc} in rp-service-runtime-contract.json", file=sys.stderr)
        fail = 1
        continue
    mode = entry.get("runtimeHealthMode")
    if mode not in allowed_modes:
        print(f"❌ {svc}: invalid or missing runtimeHealthMode ({mode!r})", file=sys.stderr)
        fail = 1
    http_port = entry.get("httpPort")
    if not isinstance(http_port, int) or http_port <= 0:
        print(f"❌ {svc}: invalid httpPort ({http_port!r})", file=sys.stderr)
        fail = 1
    for field in ("healthPath", "readyPath"):
        val = entry.get(field)
        if not val or not isinstance(val, str):
            print(f"❌ {svc}: missing {field}", file=sys.stderr)
            fail = 1
    tls = entry.get("tlsPolicy")
    if tls not in allowed_tls:
        print(f"❌ {svc}: invalid tlsPolicy ({tls!r})", file=sys.stderr)
        fail = 1
    k8s = entry.get("k8sName") or entry.get("k8sService")
    if not k8s:
        print(f"❌ {svc}: missing k8sName/k8sService", file=sys.stderr)
        fail = 1
    grpc_port = entry.get("grpcPort")
    if mode in ("grpc", "both") and (grpc_port is None or grpc_port == ""):
        print(f"❌ {svc}: runtimeHealthMode={mode} requires grpcPort", file=sys.stderr)
        fail = 1
    if isinstance(grpc_port, int) and grpc_port <= 0:
        print(f"❌ {svc}: invalid grpcPort ({grpc_port!r})", file=sys.stderr)
        fail = 1
    print(f"✅ {svc}: static contract OK (mode={mode}, httpPort={http_port})")
if fail:
    sys.exit(1)
print("✅ no RP legacy names in contract")
PY

if [[ "$MODE" == "static" ]]; then
  if [[ "$FAIL" -ne 0 ]]; then
    exit 1
  fi
  echo "✅ static runtime health contract passed"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || bad "kubectl required for --mode live"
if ! kubectl cluster-info >/dev/null 2>&1; then
  bad "kubectl cluster not reachable for --mode live"
fi

for svc in "${RP_RUNTIME_APP_DEPLOYS[@]}"; do
  if ! rp_runtime_health_service_json "$svc" >/dev/null 2>&1; then
    bad "missing runtime health config for $svc in rp-service-runtime-contract.json"
    continue
  fi
  http_port="$(rp_runtime_health_field "$svc" httpPort)"
  k8s="$(rp_runtime_health_field "$svc" k8sName)"
  [[ -z "$k8s" ]] && k8s="$(rp_runtime_health_field "$svc" k8sService)"
  if ! kubectl get svc "$k8s" -n "$NS" >/dev/null 2>&1; then
    bad "$svc: Service/$k8s not in cluster (namespace=$NS)"
    continue
  fi
  sp="$(kubectl get svc "$k8s" -n "$NS" -o jsonpath='{.spec.ports[?(@.name=="http")].port}' 2>/dev/null || true)"
  [[ -z "$sp" ]] && sp="$(kubectl get svc "$k8s" -n "$NS" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
  if [[ -n "$sp" && "$sp" != "$http_port" ]]; then
    bad "$svc: contract httpPort=$http_port but Service port=$sp"
  else
    ok "$svc: httpPort=$http_port matches Service"
  fi
  ep_count="$(kubectl get endpoints "$k8s" -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w | tr -d ' ')"
  if [[ "${ep_count:-0}" -lt 1 ]]; then
    bad "$svc: Service/$k8s has no ready endpoints"
  else
    ok "$svc: Service/$k8s endpoints=${ep_count}"
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
echo "✅ live runtime health contract passed"
