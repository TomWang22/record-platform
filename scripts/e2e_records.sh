#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:8080/api}"

need() { command -v "$1" >/dev/null || { echo "Missing $1"; exit 1; }; }
need curl; need jq; need tr; need cut; need base64

CURL="curl -sS -f --connect-timeout 5 --max-time 30"

AUTH_GATEWAY_URL="${AUTH_GATEWAY_URL:-$API/auth/login}"
AUTH_DIRECT_URL="${AUTH_DIRECT_URL:-http://auth-service:4001/auth/login}"

EMAIL="${EMAIL:-qa_$(date +%s)@example.com}"
PASS="${PASS:-p@ssw0rd}"
SKIP_REGISTER="${SKIP_REGISTER:-1}"
DIRECT_AUTH="${DIRECT_AUTH:-0}"

if [ "$DIRECT_AUTH" = "1" ]; then
  case "$AUTH_DIRECT_URL" in
    http://auth-service:4001|http://auth-service:4001/*)
      echo "DIRECT_AUTH=1 is set but AUTH_DIRECT_URL points to 'auth-service', which only resolves inside Docker."
      echo "Publish 4001:4001 and set AUTH_DIRECT_URL=http://localhost:4001/auth/login, or unset DIRECT_AUTH."
      exit 1
      ;;
  esac
fi

diag() {
  echo
  echo "==== DIAG: docker compose ps ===="
  docker compose ps || true
  echo
  echo "==== DIAG: recent logs (api-gateway, records-service, nginx, postgres) ===="
  docker compose logs --since=5m api-gateway records-service nginx postgres 2>/dev/null | tail -n 400 || true
}
trap diag ERR

wait_http() {
  local url="$1" max="${2:-180}"
  echo "Waiting for $url (max ${max}s)…"
  for ((i=1; i<=max; i++)); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo 000)
    if [ "$code" = "200" ]; then
      echo "OK: $url"
      return 0
    fi
    sleep 1
  done
  echo "Timeout waiting for $url"
  exit 1
}

b64url() {
  local data="$1" pad=""
  case $(( ${#data} % 4 )) in
    2) pad="==";;
    3) pad="=";;
    0) ;;
  esac
  printf '%s' "$data$pad" | tr '-_' '+/' | base64 -d 2>/dev/null || return 1
}

decode_jwt_sub() {
  local token="$1" payload decoded
  payload=$(printf '%s' "$token" | cut -d. -f2)
  [ -n "$payload" ] || return 0
  decoded=$(b64url "$payload" || true)
  [ -n "$decoded" ] || return 0
  printf '%s' "$decoded" | jq -r '.sub // empty'
}

login_via_gateway() {
  local body
  body=$(
    curl -sS -D - -H 'content-type: application/json' \
      -X POST "$AUTH_GATEWAY_URL" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
    | awk 'NR==1,/^\r?$/{print > "/dev/stderr"; next} {print}'
  ) || return 1

  echo "$body" | jq -e '.token and (.token|type=="string") and (.token|length>20)' >/dev/null \
    || { echo "Login via gateway returned no/short token. Body was:"; echo "$body"; return 2; }

  echo "$body" | jq -r .token
}

login_via_auth() {
  local body
  body=$(
    curl -sS -D - -H 'content-type: application/json' \
      -X POST "$AUTH_DIRECT_URL" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
    | awk 'NR==1,/^\r?$/{print > "/dev/stderr"; next} {print}'
  ) || return 1

  echo "$body" | jq -e '.token and (.token|type=="string") and (.token|length>20)' >/dev/null \
    || { echo "Direct auth returned no/short token. Body was:"; echo "$body"; return 2; }

  echo "$body" | jq -r .token
}

register() {
  echo "== Register =="
  if [ "$SKIP_REGISTER" = "1" ]; then
    echo "Skipping registration (SKIP_REGISTER=1)."
    return 0
  fi

  if ! $CURL -X POST "$API/auth/register" -H 'content-type: application/json' \
       -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq .; then
    echo "Register returned non-2xx (continuing to login)."
  fi
}

echo "Using EMAIL=$EMAIL"

echo "== Wait for API =="
wait_http "$API/healthz" 180

echo "== Health =="
$CURL "$API/healthz" | jq .

register

echo "== Login (grab JWT) =="
if [ "$DIRECT_AUTH" = "1" ]; then
  echo "DIRECT_AUTH=1 → $AUTH_DIRECT_URL"
  JWT="$(login_via_auth)" || { echo "Direct login failed"; exit 1; }
else
  JWT="$(login_via_gateway)" || {
    echo "Gateway login failed; try: DIRECT_AUTH=1 AUTH_DIRECT_URL=http://localhost:4001/auth/login"
    exit 1
  }
fi

if [ -z "${JWT:-}" ] || [ "$JWT" = "null" ]; then
  echo "Login failed (empty token)."
  exit 1
fi
echo "JWT=${JWT:0:32}…"

echo "== Who am I =="
WHOAMI_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/__whoami" -H "Authorization: Bearer $JWT" || true)
if [ "$WHOAMI_CODE" = "200" ]; then
  ME=$(curl -s "$API/__whoami" -H "Authorization: Bearer $JWT" | jq -r '.user.sub // .sub // empty')
else
  ME=$(decode_jwt_sub "$JWT")
fi
if [ -n "${ME:-}" ]; then
  echo "UserId=$ME"
else
  echo "UserId=unknown (decoded none)"
fi

# ---------- Create two records ----------
echo "== Create record #1 (LP) =="
ID1=$($CURL -X POST "$API/records" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"artist":"Radiohead","name":"Kid A","format":"LP"}' | jq -r .id)
echo "ID1=$ID1"; [ -n "$ID1" ] || exit 1

echo "== Create record #2 (EP via 7\") =="
ID2=$($CURL -X POST "$API/records" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"artist":"Nirvana","name":"Smells Like Teen Spirit","format":"Single"}' | jq -r .id)
echo "ID2=$ID2"; [ -n "$ID2" ] || exit 1

# ---------- Update with lenient grades + metadata ----------
echo "== Update ID1 (lenient grades + 12\" piece) =="
$CURL -X PUT "$API/records/$ID1" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  --data-binary @- <<'JSON' | jq .
{
  "recordGrade": "Very Good Plus",
  "sleeveGrade": "VG PLUS",
  "label": "Parlophone",
  "labelCode": "7243 5 27753 1 0",
  "releaseYear": 2000,
  "pressingYear": 2000,
  "releaseDate": "2000-10-02",
  "hasInsert": true,
  "insertGrade": "nm-",
  "mediaPieces": [
    { "index": 1, "kind": "vinyl", "sizeInch": 12, "speedRpm": 33,
      "discGrade": "vg_plus", "sides": { "A": "EX", "B": "vg plus" } }
  ]
}
JSON

echo "== Update ID2 with 7\" (auto EP, 45 RPM, sides A/B) =="
$CURL -X PUT "$API/records/$ID2" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  --data-binary @- <<'JSON' | jq .
{
  "recordGrade": "NM",
  "label": "DGC",
  "labelCode": "DGCS7",
  "releaseYear": 1991,
  "pressingYear": 1991,
  "mediaPieces": [
    { "index": 1, "kind": "7\"", "discGrade": "NM",
      "sides": { "A": "NM", "B": "VG+" } }
  ]
}
JSON

# ---------- Add a second disc to ID1 and verify C/D rollover ----------
echo "== Add second 12\" disc to ID1 (expect sides C/D) =="
RES=$($CURL -X PUT "$API/records/$ID1" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{
  "mediaPieces": [
    { "index": 2, "kind": "vinyl", "sizeInch": 12, "speedRpm": 33,
      "discGrade": "EX-", "sides": { "A": "EX", "B": "VG+" } }
  ]
}
JSON
)
echo "$RES" | jq .
CD_OK=$(echo "$RES" | jq -r '.mediaPieces[] | select(.index==2) | .sides | has("C") and has("D")')
[ "$CD_OK" = "true" ] || { echo "Expected C/D rollover on index 2"; exit 1; }

# ---------- List & Get ----------
echo "== List (should include both IDs) =="
$CURL "$API/records" -H "Authorization: Bearer $JWT" | jq '[.[].id]'

echo "== Get ID1 =="
$CURL "$API/records/$ID1" -H "Authorization: Bearer $JWT" | jq .

echo "== Get ID2 =="
$CURL "$API/records/$ID2" -H "Authorization: Bearer $JWT" | jq .

# ---------- Partial updates & nulling fields ----------
echo "== Null some extras on ID1 =="
$CURL -X PUT "$API/records/$ID1" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"hasInsert":false,"insertGrade":null,"notes":null,"pricePaid":null,"purchasedAt":null}' | jq .

# ---------- Delete ID2 ----------
echo "== Delete ID2 =="
$CURL -i -X DELETE "$API/records/$ID2" -H "Authorization: Bearer $JWT" | sed -n '1,5p'
echo "== Get ID2 (expect 404) =="
curl -s -i "$API/records/$ID2" -H "Authorization: Bearer $JWT" | sed -n '1,8p'

# ---------- Persistence check across restart ----------
echo "== Restart all containers (DB persists) =="
make restart-all >/dev/null
wait_http "$API/healthz" 180

echo "== Get ID1 after restart =="
$CURL "$API/records/$ID1" -H "Authorization: Bearer $JWT" | jq . > /dev/null
echo "OK: ID1 still present after restart"

unset JWT
echo "Logged out (JWT unset)."
echo "All good ✅"
