#!/usr/bin/env bash
set -Eeuo pipefail

# Update KNN benchmark to use search_norm_short

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "Updating KNN benchmark to use search_norm_short..."

# Update the benchmark SQL file in the pod
kubectl -n "$NS" exec "$PGPOD" -c db -- bash -c 'cat > /tmp/bench_sql/bench_knn.sql <<'\''SQL'\''
SELECT count(*) FROM (
  SELECT h.id
  FROM records_hot.records_hot h
  ORDER BY h.search_norm_short <-> lower(:q::text)
  LIMIT :lim::integer
) s;
SQL
'

echo "✅ KNN benchmark updated to use search_norm_short"

