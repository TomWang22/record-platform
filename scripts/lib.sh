#!/usr/bin/env bash
set -Eeuo pipefail

: "${NS:=record-platform}"
: "${DB:=records}"

get_pod() {
  if [[ -n "${PGPOD:-}" ]]; then echo "$PGPOD"; return; fi
  kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}'
}

psql_in() {
  local pod; pod="$(get_pod)"
  kubectl -n "$NS" exec -i "$pod" -c db -- psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"
}

bash_in() {
  local pod; pod="$(get_pod)"
  kubectl -n "$NS" exec -i "$pod" -c db -- bash -lc "$*"
}

