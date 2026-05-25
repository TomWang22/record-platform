#!/usr/bin/env bash
# Load runtime health fields from infra/contracts/rp-service-runtime-contract.json
set -euo pipefail

_RP_RT_HEALTH_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_RP_RT_HEALTH_REPO="$(cd "$_RP_RT_HEALTH_LIB_DIR/../.." && pwd)"
RP_SERVICE_RUNTIME_CONTRACT="${RP_SERVICE_RUNTIME_CONTRACT:-$_RP_RT_HEALTH_REPO/infra/contracts/rp-service-runtime-contract.json}"

# shellcheck source=scripts/lib/rp-runtime-deploy-services.sh
source "$_RP_RT_HEALTH_LIB_DIR/rp-runtime-deploy-services.sh"

_rp_runtime_health_python() {
  python3 - "$RP_SERVICE_RUNTIME_CONTRACT" "$@" <<'PY'
import json, sys
path, mode = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    doc = json.load(f)
services = doc.get("services") or {}

if mode == "runtime-names":
    deploys = [x.strip() for x in sys.argv[3].split(",") if x.strip()]
    for n in deploys:
        if n in services:
            print(n)
elif mode == "get-json":
    name = sys.argv[3]
    svc = services.get(name)
    if not svc:
        sys.exit(2)
    print(json.dumps(svc))
elif mode == "field":
    name, field = sys.argv[3], sys.argv[4]
    svc = services.get(name) or {}
    v = svc.get(field)
    if v is None:
        print("")
    elif isinstance(v, bool):
        print("true" if v else "false")
    else:
        print(v)
else:
    sys.stderr.write(f"unknown mode {mode}\n")
    sys.exit(2)
PY
}

rp_runtime_health_contract_path() {
  printf '%s' "$RP_SERVICE_RUNTIME_CONTRACT"
}

rp_runtime_health_runtime_services() {
  local joined
  joined="$(IFS=,; echo "${RP_RUNTIME_APP_DEPLOYS[*]}")"
  _rp_runtime_health_python runtime-names "$joined"
}

rp_runtime_health_service_json() {
  local name="$1"
  _rp_runtime_health_python get-json "$name"
}

rp_runtime_health_field() {
  local name="$1" field="$2"
  _rp_runtime_health_python field "$name" "$field"
}
