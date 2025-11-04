#!/usr/bin/env bash
# Lightweight connectivity check covering PgBouncer and records-service
set -euo pipefail

NS="${1:-record-platform}"
APP="records-service"

# PgBouncer connectivity
kubectl -n "$NS" run psql --rm -it --image=postgres:16 -- \
 'psql "host=pgbouncer.record-platform.svc.cluster.local port=6432 dbname=records user=record_app password=SUPER_STRONG_APP_PASSWORD sslmode=disable" -c SELECT\ 1;'

# Service liveness
kubectl -n "$NS" run curl-rs --rm -it --restart=Never --image=curlimages/curl:8.10.1 -- \
  sh -lc 'curl -sS http://'"$APP"'.record-platform.svc.cluster.local:4002/_ping && echo'
