#!/usr/bin/env bash
set -euo pipefail
NS="${NS:-record-platform}"
NAME="pg-backup-pvc-$(date +%s)"
kubectl -n "$NS" create job --from=cronjob/pg-backup-pvc "$NAME"
kubectl -n "$NS" logs -f job/"$NAME" --tail=200 || true
kubectl -n "$NS" wait --for=condition=Complete job/"$NAME" --timeout=20m
