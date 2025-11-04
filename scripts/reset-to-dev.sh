#!/usr/bin/env bash
set -euo pipefail
NS=record-platform

echo "→ Patch records-service probes to /_ping"
kubectl -n "$NS" patch deploy/records-service --type=json -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/path","value":"/_ping"},
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/_ping"},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/initialDelaySeconds","value":90},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/failureThreshold","value":10}
]' || true
kubectl -n "$NS" rollout status deploy/records-service || true

echo "→ Apply overlay"
kubectl apply -k infra/k8s/overlays/dev

echo "→ Create ephemeral post-init Job"
JOB=$(kubectl -n "$NS" create -f infra/k8s/overlays/dev/jobs/postgres-postinit-job-template.yaml -o jsonpath='{.metadata.name}')
echo "Job: $JOB"

echo "→ Stream logs and wait"
for _ in {1..120}; do
  POD=$(kubectl -n "$NS" get pods -l job-name="${JOB}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  [[ -n "${POD:-}" ]] && break
  sleep 1
done
[[ -z "${POD:-}" ]] && { kubectl -n "$NS" describe job "$JOB"; exit 1; }

kubectl -n "$NS" logs "$POD" -c psql --follow --tail=-1 || true
kubectl -n "$NS" wait --for=condition=Complete "job/${JOB}" --timeout=15m

echo "→ Verify"
bash scripts/verify-dev.sh
