#!/usr/bin/env bash
# Compare on-disk mTLS leaf SANs to certPolicy + optional in-cluster mounted tls.crt.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"
# shellcheck source=lib/rp-service-cert-contract.sh
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
CHECK_CLUSTER="${AUDIT_GRPC_SANS_CLUSTER:-1}"
FAIL=0
bad() { echo "❌ $*" >&2; FAIL=1; }
ok() { echo "✅ $*"; }

command -v openssl >/dev/null 2>&1 || { bad "openssl required"; exit 1; }
CERTS="$(rp_dev_certs_dir)"

_sans_file() {
  openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null \
    | tr ',' '\n' | sed -n 's/^[[:space:]]*DNS://p' | sed 's/^ *//' | sort -u
}

_expected_sans() {
  rp_cert_contract_sans_for_service "$1" | tr ',' '\n' | sed 's/^DNS://' | sort -u
}

while IFS= read -r svc; do
  [[ -n "$svc" ]] || continue
  crt="$CERTS/${svc}.crt"
  [[ -f "$crt" ]] || { bad "missing $crt (run dev-generate-certs.sh)"; continue; }
  exp="$(_expected_sans "$svc")"
  got="$(_sans_file "$crt")"
  missing="$(comm -23 <(echo "$exp") <(echo "$got") || true)"
  if [[ -n "$missing" ]]; then
    bad "$svc.crt missing SANs: $(echo "$missing" | tr '\n' ' ')"
  else
    ok "$svc.crt SANs match contract"
  fi

  if [[ "$CHECK_CLUSTER" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
    sec="$(rp_cert_contract_per_service_secret_name "$svc")"
    if kubectl get secret "$sec" -n "$NS" >/dev/null 2>&1; then
      tmp="$(mktemp)"
      kubectl get secret "$sec" -n "$NS" -o jsonpath='{.data.tls\.crt}' | base64 -d >"$tmp" 2>/dev/null || true
      if [[ -s "$tmp" ]]; then
        kmissing="$(comm -23 <(echo "$exp") <(_sans_file "$tmp") || true)"
        [[ -z "$kmissing" ]] && ok "secret/$sec tls.crt SANs OK" \
          || bad "secret/$sec tls.crt missing SANs: $(echo "$kmissing" | tr '\n' ' ')"
      fi
      rm -f "$tmp"
    fi
  fi
done < <(rp_cert_contract_mtls_services)

[[ "$FAIL" -eq 0 ]] && { echo "✅ audit-rp-grpc-cert-sans passed"; exit 0; }
exit 1
