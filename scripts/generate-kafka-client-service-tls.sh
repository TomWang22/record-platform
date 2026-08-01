#!/usr/bin/env bash
# Generate dedicated Kafka client leaves (clientAuth-only) per participant service.
# Trust boundary: separate from service-tls-* (gRPC/app) and from shared kafka-ssl-secret client.crt.
#
# Output (gitignored under certs/):
#   certs/kafka-client/<service>/{tls.crt,tls.key,ca-chain.pem,leaf.crt,meta.json}
#
# Env:
#   RP_KAFKA_CLIENT_TLS_FORCE=1  — regenerate all leaves
#   KAFKA_CLIENT_TLS_NS=record-platform
#   RP_DEV_CERT_DAYS=365
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
# shellcheck source=lib/rp-dev-ca.sh
source "$SCRIPT_DIR/lib/rp-dev-ca.sh"

OUT_ROOT="${REPO_ROOT}/certs/kafka-client"
DAYS="${RP_DEV_CERT_DAYS:-365}"
FORCE="${RP_KAFKA_CLIENT_TLS_FORCE:-0}"

SERVICES=(
  analytics-service
  auction-monitor
  auth-service
  listings-service
  media-service
  messaging-service
  notification-service
  python-ai-service
  shopping-service
  trust-service
  ollama-gateway
  ollama-worker
)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || fail "openssl required"
command -v python3 >/dev/null 2>&1 || fail "python3 required"

rp_dev_bootstrap_chain
mkdir -p "$OUT_ROOT"

ROOT_FP="$(openssl x509 -in "$(rp_dev_root_pem)" -noout -fingerprint -sha256 | sed 's/.*=//')"
INT_FP="$(openssl x509 -in "$(rp_dev_intermediate_pem)" -noout -fingerprint -sha256 | sed 's/.*=//')"

generated=0
for svc in "${SERVICES[@]}"; do
  dir="${OUT_ROOT}/${svc}"
  mkdir -p "$dir"
  leaf="${dir}/leaf.crt"
  key="${dir}/tls.key"
  chain_out="${dir}/tls.crt"
  ca_chain="${dir}/ca-chain.pem"
  meta="${dir}/meta.json"
  tmp="${REPO_ROOT}/.kafka-client-tls-tmp.$$.${svc}"
  mkdir -p "$tmp"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN

  if [[ "$FORCE" == "1" ]]; then
    rm -f "$leaf" "$key" "$chain_out" "$ca_chain" "$meta"
  fi

  if [[ -f "$leaf" && -f "$key" && "$FORCE" != "1" ]]; then
    ok "reuse existing leaf for ${svc}"
  else
    say "Signing Kafka client leaf: ${svc}"
    openssl genrsa -out "$key" 2048 2>/dev/null
    openssl req -new -key "$key" -out "${tmp}/leaf.csr" \
      -subj "/CN=${svc}/O=Record Platform" 2>/dev/null
    cat >"${tmp}/leaf.ext" <<EOF
[kafka_client_tls]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
subjectAltName = @sans
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer

[sans]
DNS.1 = ${svc}
DNS.2 = ${svc}.record-platform.svc.cluster.local
URI.1 = spiffe://record-platform/service/${svc}
EOF
    openssl x509 -req -in "${tmp}/leaf.csr" \
      -CA "$(rp_dev_intermediate_pem)" -CAkey "$(rp_dev_intermediate_key)" \
      -CAserial "$(rp_dev_certs_dir)/dev-intermediate.srl" -CAcreateserial \
      -out "$leaf" -days "$DAYS" -sha256 \
      -extensions kafka_client_tls -extfile "${tmp}/leaf.ext" 2>/dev/null \
      || fail "sign failed for ${svc}"
  fi

  # tls.crt = leaf + intermediate (common K8s pattern); ca-chain = intermediate + root
  cat "$leaf" "$(rp_dev_intermediate_pem)" >"$chain_out"
  cp "$(rp_dev_chain_pem)" "$ca_chain"

  rp_dev_verify_leaf_chain "$leaf" | grep -q ': OK' || fail "chain verify failed: ${svc}"

  text="$(openssl x509 -in "$leaf" -noout -text)"
  echo "$text" | grep -q 'TLS Web Client Authentication' || fail "clientAuth missing: ${svc}"
  if echo "$text" | grep -A2 'Extended Key Usage' | grep -qi 'TLS Web Server Authentication'; then
    fail "serverAuth must be absent: ${svc}"
  fi
  echo "$text" | grep -q "URI:spiffe://record-platform/service/${svc}" || fail "SPIFFE SAN missing: ${svc}"

  leaf_fp="$(openssl x509 -in "$leaf" -noout -fingerprint -sha256 | sed 's/.*=//')"
  serial="$(openssl x509 -in "$leaf" -noout -serial | sed 's/.*=//')"
  subject="$(openssl x509 -in "$leaf" -noout -subject -nameopt RFC2253 | sed 's/^subject= *//')"
  not_before="$(openssl x509 -in "$leaf" -noout -startdate | sed 's/notBefore=//')"
  not_after="$(openssl x509 -in "$leaf" -noout -enddate | sed 's/notAfter=//')"
  key_mod="$(openssl rsa -in "$key" -noout -modulus 2>/dev/null | openssl md5)"
  crt_mod="$(openssl x509 -in "$leaf" -noout -modulus 2>/dev/null | openssl md5)"
  [[ "$key_mod" == "$crt_mod" ]] || fail "key/leaf mismatch: ${svc}"

  # DNS SANs + URI
  sans_dns="$(echo "$text" | awk '/DNS:/{gsub(/.*DNS:/,""); gsub(/,.*/,""); print}' | paste -sd, - || true)"
  sans_uri="$(echo "$text" | awk '/URI:/{gsub(/.*URI:/,""); gsub(/,.*/,""); print}' | paste -sd, - || true)"

  python3 - "$meta" <<PY
import json, sys
meta_path = sys.argv[1]
doc = {
  "service": "${svc}",
  "secret_name": "kafka-client-tls-${svc}",
  "subject_openssl_rfc2253": """${subject}""",
  "serial_hex": "${serial}",
  "not_before": "${not_before}",
  "not_after": "${not_after}",
  "leaf_sha256": "${leaf_fp}",
  "intermediate_sha256": "${INT_FP}",
  "root_sha256": "${ROOT_FP}",
  "dns_sans": [s for s in "${sans_dns}".split(",") if s],
  "uri_sans": [s for s in "${sans_uri}".split(",") if s],
  "key_usage": ["digitalSignature"],
  "eku": ["clientAuth"],
  "serverAuth_absent": True,
  "key_leaf_match": True,
  "chain_valid": True,
  "paths": {
    "leaf_crt": "certs/kafka-client/${svc}/leaf.crt",
    "tls_crt_leaf_plus_intermediate": "certs/kafka-client/${svc}/tls.crt",
    "tls_key": "certs/kafka-client/${svc}/tls.key",
    "ca_chain": "certs/kafka-client/${svc}/ca-chain.pem",
  },
  "mount_paths": {
    "tls_crt": "/etc/kafka/client/tls.crt",
    "tls_key": "/etc/kafka/client/tls.key",
    "ca_chain": "/etc/kafka/client/ca-chain.pem",
  },
  "trust_boundary": "dedicated_kafka_client_not_service_tls",
}
open(meta_path, "w", encoding="utf-8").write(json.dumps(doc, indent=2) + "\n")
PY

  generated=$((generated + 1))
  ok "${svc} leaf=${leaf_fp}"
done

# Aggregate sanitized public metadata (safe to commit from a separate report writer)
AGG="${OUT_ROOT}/generation-summary.json"
python3 - "$AGG" "$OUT_ROOT" <<'PY'
import json, pathlib, sys
agg_path, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
rows = []
fps = set()
for meta in sorted(root.glob("*/meta.json")):
    d = json.loads(meta.read_text())
    rows.append(d)
    fps.add(d["leaf_sha256"])
summary = {
    "document": "kafka-client-tls-generation-summary",
    "client_leaves_expected": 12,
    "client_leaves_generated": len(rows),
    "distinct_leaf_fingerprints": len(fps),
    "clientAuth_present": sum(1 for r in rows if "clientAuth" in r.get("eku", [])),
    "serverAuth_absent": sum(1 for r in rows if r.get("serverAuth_absent") is True),
    "spiffe_uri_present": sum(1 for r in rows if any(u.startswith("spiffe://record-platform/service/") for u in r.get("uri_sans", []))),
    "key_leaf_match": sum(1 for r in rows if r.get("key_leaf_match")),
    "chain_valid": sum(1 for r in rows if r.get("chain_valid")),
    "services": rows,
}
agg_path.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({k: summary[k] for k in summary if k != "services"}, indent=2))
PY

say "Generated ${generated}/12 Kafka client leaves under ${OUT_ROOT}"
ok "Private keys remain under certs/ (gitignored). Do not commit keys."
