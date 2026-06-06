#!/usr/bin/env bash
# Reproduce forum post vote 502: register, create post, vote, capture logs.
# Usage: ./scripts/repro-forum-vote-502.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

HOST="${HOST:-record.local}"
PORT="${PORT:-443}"
TARGET_IP="${TARGET_IP:-192.168.64.240}"
CURL_RESOLVE_IP="${TARGET_IP}"

# CA cert for strict TLS
K8S_CA=$(kubectl -n record-platform get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA" ]]; then
  CA_CERT="/tmp/test-ca-repro-$$.pem"
  echo "$K8S_CA" > "$CA_CERT"
  CURL_OPTS=(--cacert "$CA_CERT")
else
  CURL_OPTS=(-k)
fi

strict_curl() {
  curl "${CURL_OPTS[@]}" "$@"
}

TEST_EMAIL="forum-vote-$(date +%s)@example.com"
echo "=== 1. Register ==="
REG=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
  "https://$HOST:${PORT}/api/auth/register" 2>&1)
REG_CODE=$(echo "$REG" | tail -1)
echo "Register HTTP: $REG_CODE"

TOKEN=$(echo "$REG" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$TOKEN" ]] && [[ "$REG_CODE" == "409" ]]; then
  echo "User exists, trying login..."
  REG=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
    "https://$HOST:${PORT}/api/auth/login" 2>&1)
  TOKEN=$(echo "$REG" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
fi

if [[ -z "$TOKEN" ]]; then
  echo "No token. Register body:"; echo "$REG" | sed '$d' | head -5
  exit 1
fi
echo "Token: ${TOKEN:0:50}..."

echo ""
echo "=== 2. Create post ==="
POST_RESP=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -X POST "https://$HOST:${PORT}/api/forum/posts" \
  -d '{"title":"Vote repro","content":"502 repro","flair":"general"}' 2>&1)
POST_CODE=$(echo "$POST_RESP" | tail -1)
echo "Create post HTTP: $POST_CODE"

FORUM_POST_ID=$(echo "$POST_RESP" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$FORUM_POST_ID" ]]; then
  echo "No post ID. Body:"; echo "$POST_RESP" | sed '$d'
  exit 1
fi
echo "Post ID: $FORUM_POST_ID"

echo ""
echo "=== 3. Vote on post ==="
VOTE_RESP=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -X POST "https://$HOST:${PORT}/api/forum/posts/$FORUM_POST_ID/vote" \
  -d '{"vote":"up"}' 2>&1)
VOTE_CODE=$(echo "$VOTE_RESP" | tail -1)
echo "Vote body: $(echo "$VOTE_RESP" | sed '$d')"
echo "Vote HTTP: $VOTE_CODE"

echo ""
echo "=== 4. Gateway logs (forum/vote/502/proxy) ==="
kubectl -n record-platform logs -l app=api-gateway --tail=100 2>/dev/null | grep -E "forum|vote|502|proxy error|socket hang" || echo "(none)"

echo ""
echo "=== 5. Social-service logs (last 20) ==="
kubectl -n record-platform logs -l app=social-service --tail=20 2>/dev/null | grep -v kafkajs || echo "(no non-Kafka logs)"

[[ -f "${CA_CERT:-}" ]] && rm -f "$CA_CERT" 2>/dev/null || true
echo ""
echo "Done. Vote HTTP code: $VOTE_CODE"
echo ""
echo "=== Quick diagnosis ==="
echo "If 502: gateway sees 'socket hang up', social sees 'request aborted'."
echo "  - Usually: gateway timeout (15s) or social/DB slow. Run: ./scripts/diagnose-502-and-analytics.sh"
echo "  - Or exec into social and curl vote directly: kubectl -n record-platform exec -it deploy/social-service -- curl -sS -X POST -H 'Content-Type: application/json' -H \"x-user-id: <USER_ID>\" -d '{\"vote\":\"up\"}' http://localhost:4006/forum/posts/<POST_ID>/vote"
