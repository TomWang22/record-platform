#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
APP=records-service
USER_ID=${USER_ID:-4ad36240-c1ad-4638-ab1b-4c8cfb04a553}

echo "✓ psql connectivity and extensions"
kubectl -n "$NS" run psql --rm -it --image=postgres:16 --env="PGPASSWORD=$(kubectl -n "$NS" get secret postgres-secret -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)" -- \
  bash -lc 'psql "host=postgres.record-platform.svc.cluster.local user=postgres dbname=records password=$PGPASSWORD" -c "\dx"'

echo "✓ /_ping"
kubectl -n "$NS" run curl --rm -it --restart=Never --image=curlimages/curl:8.10.1 -- \
  curl -fsS http://$APP.$NS.svc.cluster.local:4002/_ping

echo "✓ autocomplete & facets"
kubectl -n "$NS" run curljq --rm -i --restart=Never --image=alpine:3.20 -- \
  sh -lc 'apk add --no-cache curl jq >/dev/null && \
    curl -sS -H "x-user-id:'"$USER_ID"'" \
      "http://'"$APP"':4002/records/search/autocomplete?field=artist&q=ter" | jq . | head -n 20 && \
    curl -sS -H "x-user-id:'"$USER_ID"'" \
      "http://'"$APP"':4002/records/search/facets?q=teresa" | jq .'
