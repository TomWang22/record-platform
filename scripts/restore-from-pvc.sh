#!/usr/bin/env bash
set -euo pipefail
NS="${NS:-record-platform}"
JOB="postgres-restore-from-pvc"
FILE="${1:-}"
kubectl -n "$NS" delete job/"$JOB" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" apply -f infra/k8s/overlays/dev/jobs/postgres-restore-from-pvc.yaml
if [[ -n "$FILE" ]]; then
  kubectl -n "$NS" set env job/"$JOB" BACKUP_FILE="$FILE"
fi
kubectl -n "$NS" logs -f job/"$JOB" --tail=200 || true
kubectl -n "$NS" wait --for=condition=Complete job/"$JOB" --timeout=30m
