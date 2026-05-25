#!/usr/bin/env bash
# Verify K8s carries all contract mTLS material (per-service + bundle secrets) with generation-id.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }
kubectl get ns "$NS" >/dev/null 2>&1 || { bad "namespace $NS missing"; exit 1; }

GEN_ID_FILE="$REPO_ROOT/certs/.rp-pki-generation-id"
EXPECTED_GEN_ID=""
if [[ -f "$GEN_ID_FILE" ]]; then
  EXPECTED_GEN_ID="$(cat "$GEN_ID_FILE")"
fi

_check_gen_id() {
  local ns="$1" name="$2"
  [[ -z "$EXPECTED_GEN_ID" ]] && return 0
  local ann created rp_anns
  ann="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.metadata.annotations.rp\.dev/pki-generation-id}' 2>/dev/null || true)"
  if [[ "$ann" == "$EXPECTED_GEN_ID" ]]; then
    ok "secret/$name generation-id matches ($ann)"
  else
    created="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null || true)"
    rp_anns="$(kubectl get secret "$name" -n "$ns" -o json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin).get("metadata",{}).get("annotations",{}); [print(f"  {k}={v}") for k,v in d.items() if k.startswith("rp.dev/")]' 2>/dev/null || true)"
    bad "secret/$name generation-id mismatch (expected=$EXPECTED_GEN_ID, got=${ann:-<none>})"
    echo "    creationTimestamp: ${created:-unknown}" >&2
    if [[ -n "$rp_anns" ]]; then
      echo "    rp.dev/* annotations:" >&2
      echo "$rp_anns" >&2
    else
      echo "    rp.dev/* annotations: none" >&2
    fi
    echo "    hint: secret content is valid but metadata missing; rerun strict-tls-bootstrap.sh or: bash scripts/rp-reannotate-pki-secrets.sh" >&2
  fi
}

_check_cert_count() {
  local ns="$1" name="$2" key="$3" expected="$4"
  local data count
  data="$(kubectl get secret "$name" -n "$ns" -o jsonpath="{.data.${key//./\\.}}" 2>/dev/null || true)"
  [[ -z "$data" ]] && { bad "secret/$name missing key $key"; return 1; }
  count="$(echo "$data" | base64 -d 2>/dev/null | awk '/BEGIN CERTIFICATE/{n++} END{print n+0}')"
  if [[ "$count" -ne "$expected" ]]; then
    bad "secret/$name $key: expected $expected certs, got $count"
    return 1
  fi
}

_check_leaf_issuer() {
  local ns="$1" name="$2"
  local data iss
  data="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.data.tls\.crt}' 2>/dev/null || true)"
  [[ -z "$data" ]] && return 1
  iss="$(echo "$data" | base64 -d 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null | sed 's/^issuer=//' || true)"
  echo "$iss" | grep -q 'record-platform-dev-intermediate' \
    || { bad "secret/$name tls.crt: leaf issuer must be intermediate ($iss)"; return 1; }
}

_check_leaf_verify() {
  local ns="$1" name="$2"
  local data tmp_crt
  data="$(kubectl get secret "$name" -n "$ns" -o jsonpath='{.data.tls\.crt}' 2>/dev/null || true)"
  [[ -z "$data" ]] && return 1
  tmp_crt="$(mktemp)"
  echo "$data" | base64 -d > "$tmp_crt" 2>/dev/null
  local leaf_only
  leaf_only="$(awk '/BEGIN CERTIFICATE/{on=1} on{print} /END CERTIFICATE/{exit}' "$tmp_crt")"
  local tmp_leaf
  tmp_leaf="$(mktemp)"
  echo "$leaf_only" > "$tmp_leaf"
  if rp_dev_verify_leaf_chain "$tmp_leaf" 2>&1 | grep -q ': OK$'; then
    ok "secret/$name leaf verifies against dev-chain.pem"
  else
    bad "secret/$name leaf does not verify against dev-chain.pem"
  fi
  rm -f "$tmp_crt" "$tmp_leaf"
}

echo "=== Bundle secret ==="
bundle="$(rp_cert_contract_bundle_secret_name)"
if kubectl get secret "$bundle" -n "$NS" >/dev/null 2>&1; then
  ok "secret/$bundle exists"
  _bundle_keys="$(kubectl get secret "$bundle" -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin).get("data",{}).keys()))' || true)"
  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    echo "$_bundle_keys" | grep -qxF "${svc}.crt" \
      && echo "$_bundle_keys" | grep -qxF "${svc}.key" \
      && ok "bundle contains ${svc}.crt + ${svc}.key" \
      || bad "bundle $bundle missing ${svc}.crt or ${svc}.key"
  done < <(rp_cert_contract_mtls_services)
  echo "$_bundle_keys" | grep -qxF 'ca.crt' && ok "bundle contains ca.crt" || bad "bundle missing ca.crt"
  echo "$_bundle_keys" | grep -qxF 'dev-chain.pem' && ok "bundle contains dev-chain.pem" || bad "bundle missing dev-chain.pem"
  _check_gen_id "$NS" "$bundle"
else
  bad "missing secret/$bundle (run strict-tls-bootstrap.sh after dev-generate-certs)"
fi

echo ""
echo "=== Per-service mTLS secrets ==="
while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  sec="$(rp_cert_contract_per_service_secret_name "$svc")"
  if ! kubectl get secret "$sec" -n "$NS" >/dev/null 2>&1; then
    bad "missing secret/$sec"
    continue
  fi
  _sec_keys="$(kubectl get secret "$sec" -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin).get("data",{}).keys()))' || true)"
  for k in tls.crt tls.key ca.crt dev-chain.pem; do
    echo "$_sec_keys" | grep -qxF "$k" || bad "secret/$sec missing key $k"
  done
  _check_cert_count "$NS" "$sec" "tls.crt" 2
  _check_cert_count "$NS" "$sec" "ca.crt" 2
  _check_leaf_issuer "$NS" "$sec"
  _check_leaf_verify "$NS" "$sec"
  _check_gen_id "$NS" "$sec"
  ok "secret/$sec (tls.crt=leaf+intermediate, ca.crt=intermediate+root)"
done < <(rp_cert_contract_mtls_services)

echo ""
echo "=== Edge + legacy secrets ==="
for legacy in service-tls edge-service-tls; do
  if kubectl get secret "$legacy" -n "$NS" >/dev/null 2>&1; then
    _check_cert_count "$NS" "$legacy" "tls.crt" 2
    _check_gen_id "$NS" "$legacy"
    ok "secret/$legacy (edge alias)"
  else
    bad "missing legacy edge secret $legacy"
  fi
done

echo ""
echo "=== Negative checks ==="
if kubectl get secret service-tls-webapp -n "$NS" >/dev/null 2>&1; then
  bad "service-tls-webapp exists but webapp must not have mTLS leaf unless certPolicy changes"
else
  ok "no service-tls-webapp (correct: webapp is edge-only)"
fi

[[ "$FAIL" -eq 0 ]] && { echo ""; echo "✅ audit-rp-k8s-service-tls-secrets passed (ns=$NS)"; exit 0; }
echo ""
echo "❌ audit-rp-k8s-service-tls-secrets failed" >&2
exit 1
