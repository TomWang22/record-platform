#!/usr/bin/env bash
# Fail-closed verification of dedicated Kafka client leaves (disk).
# Does not touch service-tls-* or enable the Kafka authorizer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_ROOT="${REPO_ROOT}/certs/kafka-client"

SERVICES=(
  analytics-service auction-monitor auth-service listings-service
  media-service messaging-service notification-service python-ai-service
  shopping-service trust-service ollama-gateway ollama-worker
)

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ -d "$OUT_ROOT" ]] || fail "missing ${OUT_ROOT}; run scripts/generate-kafka-client-service-tls.sh"

fps=()
for svc in "${SERVICES[@]}"; do
  leaf="${OUT_ROOT}/${svc}/leaf.crt"
  key="${OUT_ROOT}/${svc}/tls.key"
  [[ -f "$leaf" && -f "$key" ]] || fail "missing leaf/key for ${svc}"
  text="$(openssl x509 -in "$leaf" -noout -text)"
  echo "$text" | grep -q 'TLS Web Client Authentication' || fail "clientAuth missing: ${svc}"
  if echo "$text" | grep -A2 'Extended Key Usage' | grep -qi 'TLS Web Server Authentication'; then
    fail "serverAuth must be absent: ${svc}"
  fi
  echo "$text" | grep -q "URI:spiffe://record-platform/service/${svc}" || fail "SPIFFE missing: ${svc}"
  openssl verify -CAfile "${REPO_ROOT}/certs/dev-root.pem" \
    -untrusted "${REPO_ROOT}/certs/dev-intermediate.pem" "$leaf" | grep -q ': OK' \
    || fail "chain verify failed: ${svc}"
  key_mod="$(openssl rsa -in "$key" -noout -modulus 2>/dev/null | openssl md5)"
  crt_mod="$(openssl x509 -in "$leaf" -noout -modulus 2>/dev/null | openssl md5)"
  [[ "$key_mod" == "$crt_mod" ]] || fail "key/leaf mismatch: ${svc}"
  fp="$(openssl x509 -in "$leaf" -noout -fingerprint -sha256 | sed 's/.*=//')"
  fps+=("$fp")
  ok "${svc} ${fp}"
done

uniq="$(printf '%s\n' "${fps[@]}" | sort -u | wc -l | tr -d ' ')"
[[ "$uniq" == "12" ]] || fail "distinct fingerprints=${uniq} expected 12"
ok "verify-kafka-client-service-tls: 12/12"
