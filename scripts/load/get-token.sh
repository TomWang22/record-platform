#!/usr/bin/env bash
set -euo pipefail

EMAIL="${EMAIL:-t@t.t}"
PASS="${PASS:-p@ssw0rd}"

json(){ printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASS"; }
extract(){ sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; }

try_edge_auth_login(){ curl -sS -H 'content-type: application/json' --data-binary "$(json)" http://localhost:8080/auth/login || true; }
try_edge_api_auth_login(){ curl -sS -H 'content-type: application/json' --data-binary "$(json)" http://localhost:8080/api/auth/login || true; }
try_direct_auth_login(){
  docker compose exec -T nginx sh -lc \
    "printf '%s' '$(json)' | curl -sS -H 'content-type: application/json' --data-binary @- http://auth-service:4001/login" || true
}

for fn in try_edge_auth_login try_edge_api_auth_login try_direct_auth_login; do
  body="$($fn)"
  tok="$(printf '%s' "$body" | extract || true)"
  if [ -n "${tok:-}" ]; then printf '%s\n' "$tok"; exit 0; fi
done

echo "ERROR: failed to obtain token" >&2
exit 1