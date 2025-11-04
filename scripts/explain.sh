#!/usr/bin/env bash
# Run an EXPLAIN ANALYZE for the fuzzy search to confirm plan shape
set -euo pipefail

NS="${1:-record-platform}"
USER_ID="${2:-}"

if [[ -z "$USER_ID" ]]; then
  echo "USER_ID is required (pass via make explain USER_ID=...)" >&2
  exit 1
fi

kubectl -n "$NS" exec -i deploy/postgres -- bash -lc \
"psql -U postgres -d records -c \"EXPLAIN (ANALYZE,BUFFERS)
 SELECT id, rank FROM public.search_records_fuzzy_ids('${USER_ID}'::uuid, '鄧麗君', 20, 0);\""
