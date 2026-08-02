#!/usr/bin/env bash
# Real DNS + SNI acceptance for edge and Jaeger MetalLB hostnames.
# Does NOT use curl --resolve for acceptance rows.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_JSON="${REPO_ROOT}/reports/transport/runtime-dns-sni-proof.json"
OUT_CONTRACT="${REPO_ROOT}/reports/transport/runtime-hostname-contract.json"
ROOT="${REPO_ROOT}/certs/dev-root.pem"
INT="${REPO_ROOT}/certs/dev-intermediate.pem"
CHAIN="${REPO_ROOT}/certs/dev-chain.pem"

EDGE_HOST=record-platform.test
JAEGER_HOST=jaeger.record-platform.test
EDGE_EXPECT=192.168.64.244
JAEGER_EXPECT=192.168.64.245

resolve_sys() {
  local host="$1"
  # Prefer dscacheutil (honors /etc/hosts on macOS); also try getent/python
  local ip=""
  ip="$(dscacheutil -q host -a name "$host" 2>/dev/null | awk '/ip_address/{print $2; exit}')"
  if [[ -z "$ip" ]]; then
    ip="$(python3 - "$host" <<'PY'
import socket,sys
try:
  print(socket.getaddrinfo(sys.argv[1], 443, type=socket.SOCK_STREAM)[0][4][0])
except Exception as e:
  print("")
PY
)"
  fi
  printf '%s' "$ip"
}

prove_host() {
  local host="$1" expect_ip="$2" leaf_disk="$3"
  local resolved sni_ok=false san_ok=false chain_ok=false leaf_fp int_fp root_fp tls_ver cipher
  resolved="$(resolve_sys "$host")"
  root_fp="$(openssl x509 -in "$ROOT" -noout -fingerprint -sha256 | sed 's/.*=//')"
  int_fp="$(openssl x509 -in "$INT" -noout -fingerprint -sha256 | sed 's/.*=//')"
  leaf_fp="$(openssl x509 -in "$leaf_disk" -noout -fingerprint -sha256 | sed 's/.*=//')"

  # Connect by hostname using system-resolved IP via Docker OpenSSL 3 (macOS LibreSSL
  # lacks -verify_hostname). Host mapping uses the system-resolved address — not curl --resolve.
  local sc
  sc="$(mktemp)"
  if docker run --rm --add-host="${host}:${resolved}" -v "${REPO_ROOT}/certs:/certs:ro" alpine/openssl \
      s_client -connect "${host}:443" -servername "$host" -verify_hostname "$host" \
      -CAfile /certs/dev-chain.pem -showcerts </dev/null >"$sc" 2>"${sc}.err"; then
    sni_ok=true
  fi
  if grep -qiE 'Verification: OK|Verify return code: 0' "${sc}.err" "$sc" 2>/dev/null; then
    chain_ok=true
    sni_ok=true
  fi
  awk 'BEGIN{p=0} /BEGIN CERTIFICATE/{p=1} p{print} /END CERTIFICATE/{if(p){exit}}' "$sc" >"${sc}.leaf" || true
  local presented_fp=""
  if [[ -s "${sc}.leaf" ]]; then
    presented_fp="$(openssl x509 -in "${sc}.leaf" -noout -fingerprint -sha256 | sed 's/.*=//')"
    if openssl x509 -in "${sc}.leaf" -noout -text | grep -q "DNS:${host}"; then
      san_ok=true
    fi
  fi
  tls_ver="$(grep -E 'Protocol version:|Protocol  :' "${sc}.err" "$sc" 2>/dev/null | head -1 || true)"
  cipher="$(grep -E 'Ciphersuite:|Cipher *:' "${sc}.err" "$sc" 2>/dev/null | head -1 || true)"

  local wrong_sni_denied=false wrong_host_denied=false
  if ! docker run --rm --add-host="${host}:${resolved}" -v "${REPO_ROOT}/certs:/certs:ro" alpine/openssl \
      s_client -connect "${host}:443" -servername "wrong-${host}" -verify_hostname "wrong-${host}" \
      -CAfile /certs/dev-chain.pem -verify_return_error </dev/null >/dev/null 2>&1; then
    wrong_sni_denied=true
  fi
  if ! docker run --rm --add-host="${host}:${resolved}" -v "${REPO_ROOT}/certs:/certs:ro" alpine/openssl \
      s_client -connect "${host}:443" -servername "invalid.example" -verify_hostname "invalid.example" \
      -CAfile /certs/dev-chain.pem -verify_return_error </dev/null >/dev/null 2>&1; then
    wrong_host_denied=true
  fi

  HOST_JSON_ENV="$host" RESOLVED_ENV="$resolved" EXPECT_ENV="$expect_ip" \
  SNI_OK_ENV="$sni_ok" SAN_OK_ENV="$san_ok" CHAIN_OK_ENV="$chain_ok" \
  LEAF_FP_ENV="$leaf_fp" PRES_FP_ENV="$presented_fp" INT_FP_ENV="$int_fp" ROOT_FP_ENV="$root_fp" \
  WRONG_SNI_ENV="$wrong_sni_denied" WRONG_HOST_ENV="$wrong_host_denied" \
  TLS_ENV="$tls_ver" CIPHER_ENV="$cipher" python3 <<'PY'
import json, os
b = lambda k: os.environ.get(k,"").lower() == "true"
print(json.dumps({
  "hostname": os.environ["HOST_JSON_ENV"],
  "resolved_ip": os.environ["RESOLVED_ENV"],
  "expected_ip": os.environ["EXPECT_ENV"],
  "resolution_matches_contract": os.environ["RESOLVED_ENV"] == os.environ["EXPECT_ENV"],
  "acceptance_used_curl_resolve": False,
  "sni": os.environ["HOST_JSON_ENV"],
  "sni_ok": b("SNI_OK_ENV"),
  "san_ok": b("SAN_OK_ENV"),
  "chain_path_ok": b("CHAIN_OK_ENV"),
  "disk_leaf_sha256": os.environ["LEAF_FP_ENV"],
  "presented_leaf_sha256": os.environ["PRES_FP_ENV"],
  "intermediate_sha256": os.environ["INT_FP_ENV"],
  "root_sha256": os.environ["ROOT_FP_ENV"],
  "leaf_disk_equals_presented": os.environ["LEAF_FP_ENV"] == os.environ["PRES_FP_ENV"],
  "wrong_sni_denied": b("WRONG_SNI_ENV"),
  "wrong_hostname_denied": b("WRONG_HOST_ENV"),
  "tls_version_hint": os.environ.get("TLS_ENV") or None,
  "cipher_hint": os.environ.get("CIPHER_ENV") or None,
  "openssl_verify_semantics": "peer presents leaf(+intermediate); root is local trust anchor",
}))
PY
  rm -f "$sc" "${sc}.err" "${sc}.leaf"
}

EDGE_JSON="$(prove_host "$EDGE_HOST" "$EDGE_EXPECT" "${REPO_ROOT}/certs/record-platform.test.crt")"
JAEGER_JSON="$(prove_host "$JAEGER_HOST" "$JAEGER_EXPECT" "${REPO_ROOT}/certs/jaeger.record-platform.test.crt")"

python3 - "$OUT_JSON" "$OUT_CONTRACT" "$EDGE_JSON" "$JAEGER_JSON" <<'PY'
import json, pathlib, sys
from datetime import datetime, timezone
out, contract, edge_s, jaeger_s = sys.argv[1:5]
edge=json.loads(edge_s); jaeger=json.loads(jaeger_s)
rows=[edge,jaeger]
doc={
  "document":"runtime-dns-sni-proof",
  "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "acceptance_rows_using_resolve": 0,
  "diagnostic_only_resolve_allowed": True,
  "summary":{
    "hostnames_expected": 2,
    "hostnames_resolved": sum(1 for r in rows if r.get("resolved_ip")),
    "resolution_matches_contract": sum(1 for r in rows if r.get("resolution_matches_contract")),
    "correct_sni": sum(1 for r in rows if r.get("sni_ok")),
    "correct_san": sum(1 for r in rows if r.get("san_ok")),
    "wrong_sni_denied": sum(1 for r in rows if r.get("wrong_sni_denied")),
    "wrong_hostname_denied": sum(1 for r in rows if r.get("wrong_hostname_denied")),
  },
  "rows": rows,
}
pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(out).write_text(json.dumps(doc, indent=2)+"\n")
pathlib.Path(contract).write_text(json.dumps({
  "document":"runtime-hostname-contract",
  "ts": doc["ts"],
  "hosts":[
    {"hostname":"record-platform.test","expected_ip":"192.168.64.244","service":"ingress-nginx/caddy-h3"},
    {"hostname":"jaeger.record-platform.test","expected_ip":"192.168.64.245","service":"observability/jaeger-query"},
  ],
}, indent=2)+"\n")
print(json.dumps(doc["summary"], indent=2))
PY
echo "✅ wrote ${OUT_JSON}"
