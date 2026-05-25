#!/usr/bin/env bash
# Read infra/contracts/rp-service-runtime-contract.json certPolicy (source of truth for mTLS leaves).
set -euo pipefail

_RP_CERT_CONTRACT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_RP_CERT_CONTRACT_REPO="$(cd "$_RP_CERT_CONTRACT_LIB_DIR/../.." && pwd)"
RP_SERVICE_RUNTIME_CONTRACT="${RP_SERVICE_RUNTIME_CONTRACT:-$_RP_CERT_CONTRACT_REPO/infra/contracts/rp-service-runtime-contract.json}"

_rp_cert_contract_python() {
  python3 - "$RP_SERVICE_RUNTIME_CONTRACT" "$@" <<'PY'
import json, sys
path, mode = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    doc = json.load(f)
policy = doc.get("certPolicy") or {}
mtls = policy.get("mtlsServices") or []
non = policy.get("nonMtls") or []

def names_mtls():
    for row in mtls:
        if row.get("mtlsRequired", True):
            print(row["serviceName"])

def cn_for(svc):
    for row in mtls:
        if row["serviceName"] == svc:
            print(row.get("certCommonName") or svc)
            return
    sys.exit(2)

def eku_for(svc):
    for row in mtls:
        if row["serviceName"] == svc:
            print(row.get("eku") or "serverAndClient")
            return
    sys.exit(2)

def all_mtls_json():
    print(json.dumps(mtls))

def non_mtls_names():
    for row in non:
        print(row["serviceName"])

def bundle_secret():
    print(policy.get("k8sBundleSecret") or "rp-service-mtls-bundle")

def per_service_prefix():
    print(policy.get("k8sPerServiceSecretPrefix") or "service-tls-")

def edge_cn():
    print(policy.get("edgeHost") or "record-platform.test")

if mode == "mtls-names":
    names_mtls()
elif mode == "cn":
    cn_for(sys.argv[3])
elif mode == "eku":
    eku_for(sys.argv[3])
elif mode == "mtls-json":
    all_mtls_json()
elif mode == "non-mtls-names":
    non_mtls_names()
elif mode == "bundle-secret":
    bundle_secret()
elif mode == "per-service-prefix":
    per_service_prefix()
elif mode == "edge-cn":
    edge_cn()
else:
    sys.stderr.write(f"unknown mode {mode}\n")
    sys.exit(2)
PY
}

rp_cert_contract_mtls_services() {
  _rp_cert_contract_python mtls-names
}

rp_cert_contract_mtls_count() {
  rp_cert_contract_mtls_services | wc -l | tr -d ' '
}

rp_cert_contract_common_name() {
  local svc="$1"
  _rp_cert_contract_python cn "$svc"
}

rp_cert_contract_eku() {
  local svc="$1"
  _rp_cert_contract_python eku "$svc"
}

rp_cert_contract_bundle_secret_name() {
  _rp_cert_contract_python bundle-secret
}

rp_cert_contract_per_service_secret_prefix() {
  _rp_cert_contract_python per-service-prefix
}

rp_cert_contract_per_service_secret_name() {
  local svc="$1"
  printf '%s%s' "$(rp_cert_contract_per_service_secret_prefix)" "$svc"
}

rp_cert_contract_edge_cn() {
  _rp_cert_contract_python edge-cn
}

rp_cert_contract_sans_for_service() {
  local svc="$1"
  local cn
  cn="$(rp_cert_contract_common_name "$svc")"
  # K8s DNS forms used by probes, Envoy, and grpc-health-probe -tls-server-name
  printf 'DNS:%s,DNS:%s.record-platform,DNS:%s.record-platform.svc,DNS:%s.record-platform.svc.cluster.local' \
    "$cn" "$cn" "$cn" "$cn"
}
