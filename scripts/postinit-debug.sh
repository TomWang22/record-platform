#!/usr/bin/env bash
set -euo pipefail
NS=record-platform
kubectl -n "$NS" delete pod/postgres-postinit-debugger --ignore-not-found
kubectl -n "$NS" apply -f infra/k8s/overlays/dev/jobs/postgres-postinit-bundle.yaml
kubectl -n "$NS" wait --for=condition=Ready pod/postgres-postinit-debugger --timeout=2m
echo "→ Exec into the pod and run:"
echo "   psql -v ON_ERROR_STOP=1 -X -f /postinit/postinit.sql"
kubectl -n "$NS" exec -it postgres-postinit-debugger -- bash
