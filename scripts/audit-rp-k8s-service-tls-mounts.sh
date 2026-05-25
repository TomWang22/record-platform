#!/usr/bin/env bash
# Fail when mTLS workloads mount legacy edge secret service-tls (record-platform.test leaf).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  dep="$svc"
  sec="$(rp_cert_contract_per_service_secret_name "$svc")"
  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    echo "ℹ️  skip deploy/$dep (not in cluster)"
    continue
  fi
  mounts="$(kubectl get deploy "$dep" -n "$NS" -o json 2>/dev/null | python3 -c '
import json,sys
d=json.load(sys.stdin)
for v in d["spec"]["template"]["spec"].get("volumes",[]):
  sec=v.get("secret",{})
  if sec.get("secretName"):
    print(sec["secretName"])
' 2>/dev/null || true)"
  if echo "$mounts" | grep -qxF 'service-tls'; then
    bad "deploy/$dep still mounts secret/service-tls (edge leaf); expected secret/$sec"
  elif echo "$mounts" | grep -qxF "$sec"; then
    ok "deploy/$dep mounts secret/$sec"
  else
    bad "deploy/$dep missing mount for secret/$sec (found: ${mounts:-none})"
  fi
done < <(rp_cert_contract_mtls_services)

[[ "$FAIL" -eq 0 ]] && { echo "✅ audit-rp-k8s-service-tls-mounts passed"; exit 0; }
exit 1
