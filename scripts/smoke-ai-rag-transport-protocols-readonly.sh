#!/usr/bin/env bash
# Read-only transport smoke: HTTP status, negotiated version, gate/fallback only.
# For response-body + sentiment/intent assertions across H1/H2/H3, use:
#   scripts/smoke-ai-rag-real-inference-response-readonly.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://record-platform.test}"
CA_CERT="${CA_CERT:-certs/dev-chain.pem}"
CONTRACT_EMAIL="${CONTRACT_EMAIL:-e2e-contract@record-platform.local}"
CONTRACT_PASSWORD="${CONTRACT_PASSWORD:-}"
CONTRACT_USER_SUB="${CONTRACT_USER_SUB:-2ed75568-7deb-4c29-91b0-6919f24a0c9f}"
QUESTION="${QUESTION:-Give me the seller intelligence summary for the current record using allowed preview context.}"
CURL_BIN="${CURL_BIN:-curl}"

[[ -n "$CONTRACT_PASSWORD" ]] || {
  echo "FAIL: CONTRACT_PASSWORD env var is required" >&2
  exit 1
}

command -v "$CURL_BIN" >/dev/null || { echo "FAIL: curl missing" >&2; exit 1; }
command -v jq >/dev/null || { echo "FAIL: jq missing" >&2; exit 1; }

"$CURL_BIN" --version | grep -q "HTTP2" || { echo "FAIL: curl lacks HTTP/2 support" >&2; exit 1; }
"$CURL_BIN" --version | grep -q "HTTP3" || { echo "FAIL: curl lacks HTTP/3 support" >&2; exit 1; }

if [[ -z "${CURL_RESOLVE:-}" ]] && [[ "$BASE_URL" == *"record-platform.test"* ]]; then
  lb_ip="$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "$lb_ip" ]]; then
    CURL_RESOLVE="record-platform.test:443:${lb_ip}"
  fi
fi

resolve_args=()
if [[ -n "${CURL_RESOLVE:-}" ]]; then
  resolve_args=(--resolve "$CURL_RESOLVE")
fi

export NGTCP2_ENABLE_GSO=0

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

login_and_query() {
  local label="$1"
  local curl_protocol_flag="$2"
  local expected_http_version="$3"

  local login_body="$TMP_DIR/${label}-login.json"
  local login_meta="$TMP_DIR/${label}-login.meta"
  local rag_body="$TMP_DIR/${label}-rag.json"
  local rag_meta="$TMP_DIR/${label}-rag.meta"

  local login_payload
  login_payload="$(jq -nc --arg email "$CONTRACT_EMAIL" --arg password "$CONTRACT_PASSWORD" \
    '{email:$email,password:$password}')"

  "$CURL_BIN" \
    --silent --show-error \
    --cacert "$CA_CERT" \
    "${resolve_args[@]}" \
    "$curl_protocol_flag" \
    --request POST \
    --header "content-type: application/json" \
    --header "X-RP-E2E-Contract: 1" \
    --data "$login_payload" \
    --write-out '%{http_code}|%{http_version}' \
    --output "$login_body" \
    "${BASE_URL}/api/auth/login" > "$login_meta"

  local login_status login_version
  login_status="$(cut -d'|' -f1 "$login_meta")"
  login_version="$(cut -d'|' -f2 "$login_meta")"

  [[ "$login_status" == "200" ]] || {
    echo "FAIL: $label login status=$login_status version=$login_version" >&2
    exit 1
  }

  [[ "$login_version" == "$expected_http_version" ]] || {
    echo "FAIL: $label login negotiated HTTP/$login_version expected HTTP/$expected_http_version" >&2
    exit 1
  }

  local token
  token="$(jq -r '
    .token //
    .accessToken //
    .access_token //
    .jwt //
    .session.accessToken //
    .session.access_token //
    empty
  ' "$login_body")"

  [[ -n "$token" && "$token" != "null" ]] || {
    echo "FAIL: $label login did not return a recognized token field" >&2
    exit 1
  }

  local rag_payload
  rag_payload="$(jq -nc --arg question "$QUESTION" --arg user_id "$CONTRACT_USER_SUB" \
    '{question:$question,user_id:$user_id}')"

  "$CURL_BIN" \
    --silent --show-error \
    --cacert "$CA_CERT" \
    "${resolve_args[@]}" \
    "$curl_protocol_flag" \
    --request POST \
    --header "content-type: application/json" \
    --header "authorization: Bearer ${token}" \
    --header "x-user-id: ${CONTRACT_USER_SUB}" \
    --data "$rag_payload" \
    --write-out '%{http_code}|%{http_version}' \
    --output "$rag_body" \
    "${BASE_URL}/api/ai/rag/query" > "$rag_meta"

  local rag_status rag_version
  rag_status="$(cut -d'|' -f1 "$rag_meta")"
  rag_version="$(cut -d'|' -f2 "$rag_meta")"

  [[ "$rag_status" == "200" ]] || {
    echo "FAIL: $label rag status=$rag_status version=$rag_version" >&2
    exit 1
  }

  [[ "$rag_version" == "$expected_http_version" ]] || {
    echo "FAIL: $label rag negotiated HTTP/$rag_version expected HTTP/$expected_http_version" >&2
    exit 1
  }

  local retrieval_mode gate_reason fallback_count
  retrieval_mode="$(jq -r '
    .details.retrieval_mode //
    .retrieval_mode //
    .retrievalMode //
    .metadata.retrieval_mode //
    .metadata.retrievalMode //
    .debug.retrieval_mode //
    empty
  ' "$rag_body")"

  gate_reason="$(jq -r '
    .details.hybrid_canary.gate_reason //
    .gate_reason //
    .gateReason //
    .metadata.gate_reason //
    .metadata.gateReason //
    .debug.gate_reason //
    empty
  ' "$rag_body")"

  fallback_count="$(jq -r '
    [
      .. | objects |
      select(
        (.fallback? == true) or
        (.hybrid_fallback? == true) or
        (.retrieval_mode? == "keyword_fallback_from_hybrid") or
        (.retrievalMode? == "keyword_fallback_from_hybrid")
      )
    ] | length
  ' "$rag_body")"

  [[ "$retrieval_mode" == "hybrid_canary" ]] || {
    echo "FAIL: $label retrieval_mode=$retrieval_mode expected hybrid_canary" >&2
    exit 1
  }

  [[ "$gate_reason" == "allowlist" ]] || {
    echo "FAIL: $label gate_reason=$gate_reason expected allowlist" >&2
    exit 1
  }

  [[ "$fallback_count" == "0" ]] || {
    echo "FAIL: $label fallback_count=$fallback_count expected 0" >&2
    exit 1
  }

  echo "$label login=$login_status rag=$rag_status|$rag_version gate=$retrieval_mode/$gate_reason fallback=0"
}

login_and_query "h1-explicit" "--http1.1" "1.1"
login_and_query "h2" "--http2" "2"
login_and_query "h3" "--http3-only" "3"

echo "PASS: HTTP/1.1, HTTP/2, and HTTP/3 RAG transport smoke"
